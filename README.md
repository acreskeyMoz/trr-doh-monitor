# TRR DoH monitor

Probes Firefox's TRR partner DoH servers (Cloudflare, NextDNS, CIRA, Wikimedia,
Quad9) every 2 hours from GitHub Actions and opens an issue when a provider's
behavior changes.

Each run, per provider (about 20s in total):

- 200 DoH queries over HTTP/2, 50ms apart, one at a time; counts failures and
  how often the server closed the connection (and how: GOAWAY, close, reset).
- Whether the server advertises HTTP/3 through Alt-Svc.
- Whether a connection survives 20s of idle.

The result is reduced to a coarse signature (for example reconnects
none/some/all). A change is reported only once the new signature has been seen
2 runs in a row, to ignore one-off network blips.

- `state/state.json`: current signature per provider.
- `state/history.jsonl`: raw numbers from every run.
- Optional: add a `SLACK_WEBHOOK_URL` repository secret to also post changes to
  Slack.

Run locally: `node probe.js [provider ...]`. Settings: `QUERIES`,
`CONCURRENCY`, `DELAY_MS`, `IDLE_SECONDS`; `CONFIRM_RUNS` for `compare.js`.
