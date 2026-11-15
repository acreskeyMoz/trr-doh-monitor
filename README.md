# TRR DoH monitor

Probes Firefox's TRR partner DoH servers (Cloudflare, NextDNS, CIRA, Wikimedia,
Quad9) every 2 hours from GitHub Actions and opens an issue when a provider's
behavior changes.

Each run, per provider (about 20s in total):

- 200 DoH queries over HTTP/2, 50ms apart, one at a time; counts failures and
  how often the server closed the connection (and how: GOAWAY, close, reset).
- Whether the server advertises HTTP/3 through Alt-Svc.
- Whether a connection survives 20s of idle.
- For providers that advertise HTTP/3: the same query series and idle check
  over HTTP/3, using curl (Node has no HTTP/3 client) from the
  `alpine/curl-http3` image.

The result is reduced to a coarse signature (for example reconnects
none/some/all). A change is reported only once the new signature has been seen
2 runs in a row, to ignore one-off network blips.

Every 6 hours, a second workflow measures how long each server keeps an idle
connection open (up to 600s) over HTTP/2, and over HTTP/3 with `h3_idle.py`
(aioquic) for providers that advertise it. Both use a long local idle timeout
and send no pings, so the server's own limit is what ends the connection.

- `state/state.json`, `state/lifetime.json`: current signature per provider.
- `state/history.jsonl`, `state/lifetime-history.jsonl`: raw numbers from
  every run.
- Optional: add a `SLACK_WEBHOOK_URL` repository secret to also post changes to
  Slack.

Run locally: `node probe.js [lifetime] [provider ...]`; set `CURL_H3` to a command that
runs an HTTP/3 curl (for example `docker run --rm -i alpine/curl-http3 curl`)
to include the HTTP/3 checks. Settings: `QUERIES`,
`CONCURRENCY`, `DELAY_MS`, `IDLE_SECONDS`; `CONFIRM_RUNS` for `compare.js`.
