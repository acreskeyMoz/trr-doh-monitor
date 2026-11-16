// Prints STATUS.md: the current state of each provider, charts of recent runs,
// and recent change issues.
//
// Usage: node status.js [issues.json] > STATUS.md
// issues.json is the output of `gh issue list --json number,title,createdAt,url`.
'use strict';
const fs = require('fs');

const DAYS = 7;
const read = p => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});
const readHistory = p =>
  fs.existsSync(p)
    ? fs
        .readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l))
        .filter(r => Date.now() - Date.parse(r.time) < DAYS * 86400e3)
    : [];

const probe = read('state/state.json');
const lifetime = read('state/lifetime.json');
const probeHistory = readHistory('state/history.jsonl');
const lifetimeHistory = readHistory('state/lifetime-history.jsonl');
const issues = process.argv[2] ? read(process.argv[2]) : [];

const day = t => t.slice(0, 16).replace('T', ' ') + ' UTC';
const mark = v =>
  v === true || v == 'none' ? '✅' : v === false || v == 'all' || v == 'failed' ? '❌' : '⚠️';
const END_LABELS = {
  cap: 'still open at cap',
  close: 'closed',
  'idle-timeout': 'QUIC idle timeout',
};
const endLabel = e =>
  END_LABELS[e] || (e && e.startsWith('goaway-') ? `GOAWAY (${e.slice(7)})` : e);
// Rows show the latest run's values; a value not yet seen CONFIRM_RUNS times in
// a row is marked as changed but not yet confirmed (no alert sent yet).
const latest = p => (p.pending ? p.pending.signature : p.current);
const pending = p =>
  p.pending ? ` → **changed ${day(p.pending.first)}, not yet confirmed (${p.pending.runs} run)**` : '';

// Old history lines stored a summary instead of the raw results.
function reconnects(p) {
  return p.series ? p.series.connections - 1 : p.reconnects;
}
function h3Reconnects(p) {
  if (!p.h3) return null;
  return p.h3.series ? Math.max(p.h3.series.connections - 1, 0) : p.h3.reconnects;
}

let out = `# TRR DoH monitor status\n\n`;
const last = probeHistory.at(-1);
out += `Updated ${day(new Date().toISOString())}. `;
out += `Last request probe: ${last ? day(last.time) : 'none'}. `;
out += `Last idle lifetime run: ${lifetimeHistory.length ? day(lifetimeHistory.at(-1).time) : 'none'}.\n\n`;
out += `✅ as expected, ⚠️ some queries affected, ❌ all queries affected or check failed. Values are from the latest run; "since" is when the confirmed state began.\n\n`;

out += `## Request series and 20s idle\n\n`;
out += `| provider | h2 failures | h2 reconnects | h2 idle | h3 | h3 failures | h3 reconnects | h3 idle | since |\n`;
out += `|---|---|---|---|---|---|---|---|---|\n`;
for (const [name, p] of Object.entries(probe)) {
  const c = latest(p);
  const raw = last && last.providers[name];
  const n = raw ? ` ${reconnects(raw)}` : '';
  const h3n = raw && h3Reconnects(raw) !== null ? ` ${h3Reconnects(raw)}` : '';
  const h3 = c.h3
    ? [mark(c.h3.failures), mark(c.h3.reconnects) + h3n, mark(c.h3.idleSurvived)]
    : ['—', '—', '—'];
  out += `| ${name} | ${mark(c.failures)} | ${mark(c.reconnects)}${n} | ${mark(c.idleSurvived)} | `;
  out += `${c.h3Advertised ? 'advertised' : 'no'} | ${h3.join(' | ')} | ${day(p.since)}${pending(p)} |\n`;
}

out += `\n## Timing\n\n`;
out += `Response time per query in the latest run: \`█\` up to the median, \`▒\` up to the 90th percentile, on one scale for all providers. `;
out += `Trend: each run's median h2 response time over the last ${DAYS} days, scaled per provider. `;
out += `Connect: per new connection (h2: TCP + TLS; h3: QUIC handshake).\n\n`;
out += `| provider | h2 response | h3 response | h2 trend, ${DAYS} days | connect h2 / h3 |\n`;
out += `|---|---|---|---|---|\n`;
const timingOf = raw => ({
  h2: raw && raw.series && raw.series.timing,
  h3: raw && raw.h3 && raw.h3.series && raw.h3.series.timing,
});
const BAR = 20;
let scale = 1;
for (const name of Object.keys(probe)) {
  const t = timingOf(last && last.providers[name]);
  for (const r of [t.h2 && t.h2.response, t.h3 && t.h3.response]) {
    if (r) scale = Math.max(scale, r.p90);
  }
}
function bar(r) {
  if (!r) return '—';
  const m = Math.max(1, Math.round((r.median / scale) * BAR));
  const p = Math.max(m, Math.round((r.p90 / scale) * BAR));
  return `\`${'█'.repeat(m)}${'▒'.repeat(p - m)}${'░'.repeat(BAR - p)}\` ${r.median} / ${r.p90} ms`;
}
function sparkline(values) {
  if (values.length < 2) return '—';
  const ticks = '▁▂▃▄▅▆▇█';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const line = values
    .map(v => ticks[hi == lo ? 0 : Math.round(((v - lo) / (hi - lo)) * (ticks.length - 1))])
    .join('');
  return `\`${line}\` ${lo}–${hi} ms`;
}
for (const name of Object.keys(probe)) {
  const t = timingOf(last && last.providers[name]);
  const trend = probeHistory
    .map(r => timingOf(r.providers[name]).h2)
    .filter(x => x && x.response)
    .map(x => x.response.median)
    .slice(-36);
  const h2c = t.h2 && t.h2.tcp && t.h2.tls ? `${t.h2.tcp.median} + ${t.h2.tls.median} ms` : '—';
  const h3c = t.h3 && t.h3.handshake ? `${t.h3.handshake.median} ms` : '—';
  out += `| ${name} | ${bar(t.h2 && t.h2.response)} | ${bar(t.h3 && t.h3.response)} | ${sparkline(trend)} | ${h2c} / ${h3c} |\n`;
}

out += `\n## Idle lifetime\n\n`;
out += `| provider | h2 | h3 | since |\n|---|---|---|---|\n`;
const lastLife = lifetimeHistory.at(-1);
for (const [name, p] of Object.entries(lifetime)) {
  const raw = lastLife && lastLife.providers[name];
  const fmt = (sig, r) =>
    sig
      ? `${r && r.seconds !== undefined ? r.seconds + 's' : sig.lifetime}, ${endLabel(sig.end)}`
      : '—';
  out += `| ${name} | ${fmt(latest(p).h2, raw && raw.h2)} | ${fmt(latest(p).h3, raw && raw.h3)} | ${day(p.since)}${pending(p)} |\n`;
}

out += `\n## Last ${DAYS} days\n\n`;
if (lifetimeHistory.length) {
  const names = Object.keys(lifetime);
  out += `Idle lifetime by run (h2 / h3, seconds):\n\n`;
  out += `| run | ${names.join(' | ')} |\n|---|${names.map(() => '---').join('|')}|\n`;
  for (const r of lifetimeHistory.slice(-12).reverse()) {
    const cell = n => {
      const p = r.providers[n];
      if (!p) return '';
      const s = x => (x && x.seconds !== undefined ? x.seconds : x ? 'fail' : '—');
      return `${s(p.h2)} / ${s(p.h3)}`;
    };
    out += `| ${day(r.time)} | ${names.map(cell).join(' | ')} |\n`;
  }
  out += '\n';
}

out += `## Recent changes\n\n`;
if (issues.length) {
  for (const i of issues) out += `- [#${i.number} ${i.title}](${i.url})\n`;
} else {
  out += `None yet.\n`;
}

process.stdout.write(out);
