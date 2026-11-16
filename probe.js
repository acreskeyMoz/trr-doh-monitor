// Probes Firefox's TRR partner DoH servers over HTTP/2, and over HTTP/3 for
// providers that advertise it, and prints a JSON report: raw numbers plus a
// normalized "signature" that only changes when a provider's behavior changes.
//
// Usage: node probe.js [lifetime] [provider ...]   (default: all providers)
// Env: QUERIES (200), CONCURRENCY (1), DELAY_MS (50), IDLE_SECONDS (20),
// CURL_H3: command that runs an HTTP/3-capable curl; the HTTP/3 checks are
// skipped when it is unset.
//
// In lifetime mode it instead measures how long each server keeps an idle
// connection open, up to MAX_IDLE_SECONDS (600), over HTTP/2 and, when H3_IDLE
// (a command that runs h3_idle.py) is set, over HTTP/3.
'use strict';
const http2 = require('http2');
const tls = require('tls');
const { spawn } = require('child_process');

const PROVIDERS = {
  cloudflare: 'https://mozilla.cloudflare-dns.com/dns-query',
  nextdns: 'https://firefox.dns.nextdns.io/',
  cira: 'https://private.canadianshield.cira.ca/dns-query',
  wikimedia: 'https://wikimedia-dns.org/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
};

const QUERIES = parseInt(process.env.QUERIES || '200', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '1', 10);
const DELAY_MS = parseInt(process.env.DELAY_MS || '50', 10);
const IDLE_SECONDS = parseInt(process.env.IDLE_SECONDS || '20', 10);
const REQUEST_TIMEOUT_MS = 10000;
const CURL_H3 = process.env.CURL_H3 ? process.env.CURL_H3.split(' ') : null;
const MAX_IDLE_SECONDS = parseInt(process.env.MAX_IDLE_SECONDS || '600', 10);
const H3_IDLE = process.env.H3_IDLE ? process.env.H3_IDLE.split(' ') : null;

const DOMAINS = [
  'example.com', 'mozilla.org', 'google.com', 'wikipedia.org', 'cloudflare.com',
  'github.com', 'amazon.com', 'microsoft.com', 'apple.com', 'debian.org',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;

// Median, 90th percentile and max of a list of milliseconds, rounded.
function stats(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const pick = q => Math.round(v[Math.min(v.length - 1, Math.floor(v.length * q))]);
  return { median: pick(0.5), p90: pick(0.9), max: Math.round(v[v.length - 1]), n: v.length };
}

function encodeQuery(name) {
  const bytes = [0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const part of name.split('.')) {
    bytes.push(part.length, ...Buffer.from(part, 'latin1'));
  }
  bytes.push(0, 0x00, 0x01, 0x00, 0x01);
  return Buffer.from(bytes);
}

// A single HTTP/2 session that records how long the TCP connect and TLS
// handshake took, and how it ended.
function openSession(url) {
  return new Promise(resolve => {
    const s = { closed: false, end: null, altSvc: '', timing: null };
    const host = new URL(url).hostname;
    const start = now();
    let lookup = start;
    let tcp = start;
    s.session = http2.connect(new URL(url).origin, {
      createConnection: () => {
        const socket = tls.connect({ host, port: 443, servername: host, ALPNProtocols: ['h2'] });
        socket.once('lookup', () => (lookup = now()));
        socket.once('connect', () => (tcp = now()));
        socket.once('secureConnect', () => {
          s.timing = { tcpMs: tcp - lookup, tlsMs: now() - tcp };
        });
        return socket;
      },
    });
    const settle = () => resolve(s);
    s.session.on('connect', settle);
    s.session.on('goaway', code => {
      s.end = s.end || `goaway-${code}`;
    });
    s.session.on('error', e => {
      s.end = s.end || `error-${e.code || e.message}`;
      settle();
    });
    s.session.on('close', () => {
      s.closed = true;
      s.end = s.end || 'close';
      settle();
    });
    s.session.setTimeout(REQUEST_TIMEOUT_MS, () => {});
  });
}

// Sends one DoH query; resolves with true if it got a usable DNS answer, and
// records the response time in s.lastMs.
function query(s, url, name) {
  return new Promise(resolve => {
    if (s.closed || s.session.destroyed) return resolve(false);
    const start = now();
    const body = encodeQuery(name);
    let req;
    try {
      req = s.session.request({
        ':method': 'POST',
        ':path': new URL(url).pathname,
        'content-type': 'application/dns-message',
        accept: 'application/dns-message',
        'content-length': body.length,
      });
    } catch (e) {
      return resolve(false);
    }
    const timer = setTimeout(() => {
      req.close();
      resolve(false);
    }, REQUEST_TIMEOUT_MS);
    let status = 0;
    const chunks = [];
    req.on('response', h => {
      status = h[':status'];
      if (h['alt-svc']) s.altSvc = h['alt-svc'];
    });
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const rcode = buf.length >= 12 ? buf[3] & 0x0f : -1;
      s.lastMs = now() - start;
      resolve(status == 200 && (rcode == 0 || rcode == 3));
    });
    req.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    req.end(body);
  });
}

// Sends QUERIES queries, reopening the session whenever the server closes it.
async function series(url) {
  let s = await openSession(url);
  const result = {
    alpn: '',
    altSvc: '',
    connections: 1,
    failures: 0,
    ends: [],
  };
  const tcpMs = [];
  const tlsMs = [];
  const responseMs = [];
  const recordConnect = () => {
    if (s.timing) {
      tcpMs.push(s.timing.tcpMs);
      tlsMs.push(s.timing.tlsMs);
    }
  };
  recordConnect();
  let next = 0;
  async function worker() {
    while (next < QUERIES) {
      const i = next++;
      if (s.closed || s.session.destroyed) {
        result.ends.push(s.end);
        result.connections++;
        s = await openSession(url);
        recordConnect();
      }
      if (await query(s, url, DOMAINS[i % DOMAINS.length])) {
        responseMs.push(s.lastMs);
      } else {
        result.failures++;
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  result.alpn = s.session.alpnProtocol || '';
  result.altSvc = s.altSvc;
  result.timing = { tcp: stats(tcpMs), tls: stats(tlsMs), response: stats(responseMs) };
  s.session.close();
  return result;
}

// Checks that a connection survives IDLE_SECONDS without traffic.
async function idle(url) {
  const s = await openSession(url);
  if (!(await query(s, url, 'example.com'))) {
    s.session.destroy();
    return { survived: false, end: s.end || 'first-query-failed' };
  }
  await sleep(IDLE_SECONDS * 1000);
  const survived = !s.closed && (await query(s, url, 'example.com'));
  const end = s.end;
  s.session.close();
  return { survived, end };
}

// Runs curl over HTTP/3 only, one query per name, at the given rate (curl's
// --rate syntax). Resolves with the number of failed queries and the number of
// connections opened.
function curlH3(url, names, rate) {
  return new Promise(resolve => {
    let config = [
      'http3-only',
      'silent',
      `rate = "${rate}"`,
      `max-time = ${REQUEST_TIMEOUT_MS / 1000}`,
      'header = "accept: application/dns-message"',
      'write-out = "%{http_code} %{http_version} %{num_connects} %{time_namelookup} %{time_appconnect} %{time_pretransfer} %{time_total}\\n"',
    ];
    for (const name of names) {
      const dns = encodeQuery(name).toString('base64url');
      config.push(`url = "${url}?dns=${dns}"`, 'output = "/dev/null"');
    }
    const curl = spawn(CURL_H3[0], [...CURL_H3.slice(1), '-K', '-']);
    let out = '';
    curl.stdout.on('data', d => (out += d));
    curl.on('error', () => resolve({ failures: names.length, connections: 0, missing: true }));
    curl.on('close', () => {
      const lines = out.trim().split('\n').filter(Boolean);
      let failures = names.length - lines.length;
      let connections = 0;
      const handshakeMs = [];
      const responseMs = [];
      for (const line of lines) {
        const [code, version, connects, lookup, appconnect, pretransfer, total] = line.split(' ');
        const ok = code == '200' && version == '3';
        if (!ok) failures++;
        const n = parseInt(connects, 10) || 0;
        connections += n;
        if (n && ok) handshakeMs.push((appconnect - lookup) * 1000);
        if (ok) responseMs.push((total - pretransfer) * 1000);
      }
      resolve({
        failures,
        connections,
        timing: { handshake: stats(handshakeMs), response: stats(responseMs) },
      });
    });
    curl.stdin.end(config.join('\n') + '\n');
  });
}

async function h3(url) {
  const names = Array.from({ length: QUERIES }, (_, i) => DOMAINS[i % DOMAINS.length]);
  const [series, idle] = await Promise.all([
    curlH3(url, names, `${Math.round(1000 / Math.max(DELAY_MS, 1))}/s`),
    curlH3(url, ['example.com', 'example.com'], `${Math.round(60 / IDLE_SECONDS)}/m`),
  ]);
  return {
    series,
    idle: { survived: idle.failures == 0 && idle.connections == 1 },
  };
}

function bucket(n, total) {
  if (n == 0) return 'none';
  return n >= total ? 'all' : 'some';
}

async function probe(name) {
  const url = PROVIDERS[name];
  const idleDone = idle(url);
  const s = await series(url);
  const h3Advertised = /\bh3=/.test(s.altSvc);
  const [i, q] = await Promise.all([
    idleDone,
    h3Advertised && CURL_H3 ? h3(url) : null,
  ]);
  return {
    raw: { series: s, idle: i, h3: q },
    signature: {
      h2Alpn: s.alpn,
      h3Advertised,
      failures: bucket(s.failures, QUERIES),
      reconnects: bucket(s.connections - 1, QUERIES),
      closeKinds: [...new Set(s.ends)].sort(),
      idleSurvived: i.survived,
      h3: q && {
        failures: bucket(q.series.failures, QUERIES),
        reconnects: bucket(Math.max(q.series.connections - 1, 0), QUERIES),
        idleSurvived: q.idle.survived,
      },
    },
  };
}

// Sends one query over HTTP/2 and returns whether it worked, whether h3 is
// advertised, and a function that waits for the server to end the connection.
async function h2Lifetime(url) {
  const s = await openSession(url);
  const ok = await query(s, url, 'example.com');
  const h3Advertised = /\bh3=/.test(s.altSvc);
  async function wait() {
    if (!ok) {
      s.session.destroy();
      return { ok, end: s.end || 'first-query-failed' };
    }
    const start = Date.now();
    const ended = new Promise(r => {
      if (s.closed) return r();
      s.session.on('goaway', r);
      s.session.on('close', r);
    });
    await Promise.race([ended, sleep(MAX_IDLE_SECONDS * 1000)]);
    const seconds = Math.min(Math.round((Date.now() - start) / 1000), MAX_IDLE_SECONDS);
    const end = s.end || 'cap';
    s.session.destroy();
    return { ok, seconds, end };
  }
  return { h3Advertised, wait };
}

function h3Lifetime(url) {
  return new Promise(resolve => {
    const p = spawn(H3_IDLE[0], [...H3_IDLE.slice(1), url, String(MAX_IDLE_SECONDS)]);
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', e => resolve({ ok: false, error: e.code }));
    p.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        resolve({ ok: false, error: 'bad-output' });
      }
    });
  });
}

// Coarse lifetime ranges, so a few seconds of jitter doesn't count as a change.
function lifetimeBucket(r) {
  if (!r.ok || r.seconds === undefined) return 'failed';
  if (r.seconds >= MAX_IDLE_SECONDS) return `>=${MAX_IDLE_SECONDS}s`;
  const edges = [0, 10, 20, 45, 90, 150, 240, 420, MAX_IDLE_SECONDS];
  const i = edges.findIndex(e => r.seconds < e);
  return `${edges[i - 1]}-${edges[i]}s`;
}

async function lifetime(name) {
  const url = PROVIDERS[name];
  const h2 = await h2Lifetime(url);
  // Some servers occasionally close right after a response, which the request
  // series already reports, so retry those to measure the idle lifetime.
  async function h2Wait() {
    let r = await h2.wait();
    let earlyCloses = 0;
    while (r.ok && r.seconds < 5 && earlyCloses < 3) {
      earlyCloses++;
      r = await (await h2Lifetime(url)).wait();
    }
    return { ...r, earlyCloses };
  }
  const [h2Result, h3] = await Promise.all([
    h2Wait(),
    h2.h3Advertised && H3_IDLE ? h3Lifetime(url) : null,
  ]);
  return {
    raw: { h2: h2Result, h3 },
    signature: {
      h2: { lifetime: lifetimeBucket(h2Result), end: h2Result.end },
      h3: h3 && { lifetime: lifetimeBucket(h3), end: h3.end || h3.error || null },
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const lifetimeMode = args[0] == 'lifetime';
  if (lifetimeMode) args.shift();
  const names = args.length ? args : Object.keys(PROVIDERS);
  const results = await Promise.all(names.map(lifetimeMode ? lifetime : probe));
  const report = {
    time: new Date().toISOString(),
    settings: lifetimeMode
      ? { MAX_IDLE_SECONDS }
      : { QUERIES, CONCURRENCY, DELAY_MS, IDLE_SECONDS },
    providers: Object.fromEntries(names.map((n, i) => [n, results[i]])),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
