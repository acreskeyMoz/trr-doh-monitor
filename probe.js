// Probes Firefox's TRR partner DoH servers over HTTP/2, and over HTTP/3 for
// providers that advertise it, and prints a JSON report: raw numbers plus a
// normalized "signature" that only changes when a provider's behavior changes.
//
// Usage: node probe.js [provider ...]   (default: all providers)
// Env: QUERIES (200), CONCURRENCY (1), DELAY_MS (50), IDLE_SECONDS (20),
// CURL_H3: command that runs an HTTP/3-capable curl; the HTTP/3 checks are
// skipped when it is unset.
'use strict';
const http2 = require('http2');
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

const DOMAINS = [
  'example.com', 'mozilla.org', 'google.com', 'wikipedia.org', 'cloudflare.com',
  'github.com', 'amazon.com', 'microsoft.com', 'apple.com', 'debian.org',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function encodeQuery(name) {
  const bytes = [0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const part of name.split('.')) {
    bytes.push(part.length, ...Buffer.from(part, 'latin1'));
  }
  bytes.push(0, 0x00, 0x01, 0x00, 0x01);
  return Buffer.from(bytes);
}

// A single HTTP/2 session that records how it ended.
function openSession(url) {
  return new Promise(resolve => {
    const s = { closed: false, end: null, altSvc: '' };
    s.session = http2.connect(new URL(url).origin);
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

// Sends one DoH query; resolves with true if it got a usable DNS answer.
function query(s, url, name) {
  return new Promise(resolve => {
    if (s.closed || s.session.destroyed) return resolve(false);
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
  let next = 0;
  async function worker() {
    while (next < QUERIES) {
      const i = next++;
      if (s.closed || s.session.destroyed) {
        result.ends.push(s.end);
        result.connections++;
        s = await openSession(url);
      }
      if (!(await query(s, url, DOMAINS[i % DOMAINS.length]))) {
        result.failures++;
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  result.alpn = s.session.alpnProtocol || '';
  result.altSvc = s.altSvc;
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
      'write-out = "%{http_code} %{http_version} %{num_connects}\\n"',
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
      for (const line of lines) {
        const [code, version, connects] = line.split(' ');
        if (code != '200' || version != '3') failures++;
        connections += parseInt(connects, 10) || 0;
      }
      resolve({ failures, connections });
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

async function main() {
  const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(PROVIDERS);
  const results = await Promise.all(names.map(probe));
  const report = {
    time: new Date().toISOString(),
    settings: { QUERIES, CONCURRENCY, DELAY_MS, IDLE_SECONDS },
    providers: Object.fromEntries(names.map((n, i) => [n, results[i]])),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
