// Compares a probe report with the saved per-provider state and reports a
// change once a provider's new signature has been seen CONFIRM_RUNS runs in a
// row, so one-off network blips don't alert.
//
// Usage: node compare.js <report.json> <state.json> <history.jsonl> <change.md>
// Writes the updated state, appends a history line, and writes change.md only
// when there is a confirmed change.
'use strict';
const fs = require('fs');

const CONFIRM_RUNS = parseInt(process.env.CONFIRM_RUNS || '2', 10);
const [reportPath, statePath, historyPath, changePath] = process.argv.slice(2);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : {};
const same = (a, b) => JSON.stringify(a) == JSON.stringify(b);

const changes = [];
for (const [name, { signature }] of Object.entries(report.providers)) {
  const p = state[name];
  if (!p) {
    state[name] = { current: signature, since: report.time, pending: null };
    continue;
  }
  if (same(signature, p.current)) {
    p.pending = null;
    continue;
  }
  if (p.pending && same(signature, p.pending.signature)) {
    p.pending.runs++;
  } else {
    p.pending = { signature, runs: 1, first: report.time };
  }
  if (p.pending.runs >= CONFIRM_RUNS) {
    changes.push({ name, from: p.current, to: signature, since: p.pending.first });
    state[name] = { current: signature, since: p.pending.first, pending: null };
  }
}

fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

const summary = Object.fromEntries(
  Object.entries(report.providers).map(([n, { raw }]) => [
    n,
    {
      alpn: raw.series.alpn,
      reconnects: raw.series.connections - 1,
      failures: raw.series.failures,
      ends: raw.series.ends,
      idleSurvived: raw.idle.survived,
      idleEnd: raw.idle.end,
    },
  ])
);
fs.appendFileSync(
  historyPath,
  JSON.stringify({ time: report.time, settings: report.settings, providers: summary }) + '\n'
);

if (changes.length) {
  let md = '';
  for (const c of changes) {
    md += `### ${c.name}\n\nSeen since ${c.since} (${CONFIRM_RUNS} runs in a row).\n\n`;
    md += '| field | before | now |\n|---|---|---|\n';
    for (const k of Object.keys({ ...c.from, ...c.to })) {
      const a = JSON.stringify(c.from[k]);
      const b = JSON.stringify(c.to[k]);
      if (a != b) md += `| ${k} | \`${a}\` | \`${b}\` |\n`;
    }
    md += `\nLatest raw result:\n\n\`\`\`json\n${JSON.stringify(summary[c.name], null, 2)}\n\`\`\`\n\n`;
  }
  fs.writeFileSync(changePath, md);
  console.log(md);
} else {
  console.log('No confirmed changes.');
}
