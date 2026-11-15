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
const pending = p => (p.pending ? ` (new value seen ${p.pending.runs}×)` : '');

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
out += `✅ as expected, ⚠️ some queries affected, ❌ all queries affected or check failed.\n\n`;

out += `## Request series and 20s idle\n\n`;
out += `| provider | h2 failures | h2 reconnects | h2 idle | h3 | h3 failures | h3 reconnects | h3 idle | since |\n`;
out += `|---|---|---|---|---|---|---|---|---|\n`;
for (const [name, p] of Object.entries(probe)) {
  const c = p.current;
  const raw = last && last.providers[name];
  const n = raw ? ` ${reconnects(raw)}` : '';
  const h3n = raw && h3Reconnects(raw) !== null ? ` ${h3Reconnects(raw)}` : '';
  const h3 = c.h3
    ? [mark(c.h3.failures), mark(c.h3.reconnects) + h3n, mark(c.h3.idleSurvived)]
    : ['—', '—', '—'];
  out += `| ${name} | ${mark(c.failures)} | ${mark(c.reconnects)}${n} | ${mark(c.idleSurvived)} | `;
  out += `${c.h3Advertised ? 'advertised' : 'no'} | ${h3.join(' | ')} | ${day(p.since)}${pending(p)} |\n`;
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
  out += `| ${name} | ${fmt(p.current.h2, raw && raw.h2)} | ${fmt(p.current.h3, raw && raw.h3)} | ${day(p.since)}${pending(p)} |\n`;
}

out += `\n## Last ${DAYS} days\n\n`;
const label = t => t.slice(8, 10) + ' ' + t.slice(11, 13) + 'h';
let quiet = [];
for (const name of Object.keys(probe)) {
  const runs = probeHistory.filter(r => r.providers[name]);
  const values = runs.map(r => reconnects(r.providers[name]));
  if (!values.some(v => v > 0)) {
    quiet.push(name);
    continue;
  }
  out += '```mermaid\nxychart-beta\n';
  out += `  title "${name}: h2 reconnects per run"\n`;
  out += `  x-axis [${runs.map(r => `"${label(r.time)}"`).join(', ')}]\n`;
  out += `  y-axis "reconnects" 0 --> ${Math.max(...values, 1)}\n`;
  out += `  bar [${values.join(', ')}]\n` + '```\n\n';
}
if (quiet.length) {
  out += `No h2 reconnects in any run: ${quiet.join(', ')}.\n\n`;
}

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
