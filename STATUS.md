# TRR DoH monitor status

Updated 2026-11-16 15:56 UTC. Last request probe: 2026-11-16 15:56 UTC. Last idle lifetime run: 2026-11-16 07:26 UTC.

✅ as expected, ⚠️ some queries affected, ❌ all queries affected or check failed.

## Request series and 20s idle

| provider | h2 failures | h2 reconnects | h2 idle | h3 | h3 failures | h3 reconnects | h3 idle | since |
|---|---|---|---|---|---|---|---|---|
| cloudflare | ✅ | ✅ 0 | ✅ | advertised | ✅ | ✅ 0 | ✅ | 2026-11-15 15:19 UTC |
| nextdns | ✅ | ✅ 0 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC |
| cira | ✅ | ⚠️ 0 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC (new value seen 1×) |
| wikimedia | ✅ | ✅ 0 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC |
| quad9 | ✅ | ✅ 0 | ✅ | advertised | ✅ | ✅ 0 | ✅ | 2026-11-15 15:19 UTC (new value seen 1×) |

## Timing (ms)

Latest run, median / 90th percentile. Connect is per new connection (h2: TCP + TLS; h3: QUIC handshake); response is per query on an open connection. 7-day column: median of each run's median response time.

| provider | h2 connect (TCP + TLS) | h2 response | h3 connect | h3 response | h2 / h3 response, 7 days |
|---|---|---|---|---|---|
| cloudflare | 8 + 9 | 3 / 4 | 10 / 10 | 5 / 6 | 3 / 5 |
| nextdns | 4 + 7 | 3 / 3 | — | — | 3 / — |
| cira | 21 + 23 | 20 / 21 | — | — | 20 / — |
| wikimedia | 2 + 6 | 1 / 3 | — | — | 1 / — |
| quad9 | 3 + 6 | 2 / 2 | 21 / 21 | 1 / 2 | 2 / 1 |

## Idle lifetime

| provider | h2 | h3 | since |
|---|---|---|---|
| cloudflare | 400s, GOAWAY (0) | 180s, close-256 | 2026-11-15 23:18 UTC |
| nextdns | 180s, GOAWAY (0) | — | 2026-11-15 15:42 UTC |
| cira | 400s, closed | — | 2026-11-15 23:18 UTC |
| quad9 | 181s, closed | 180s, QUIC idle timeout | 2026-11-15 15:42 UTC |

## Last 7 days

Idle lifetime by run (h2 / h3, seconds):

| run | cloudflare | nextdns | cira | quad9 |
|---|---|---|---|---|
| 2026-11-16 07:26 UTC | 400 / 180 | 180 / — | 400 / — | 181 / 180 |
| 2026-11-15 23:18 UTC | 400 / 180 | 180 / — | 401 / — | 181 / 180 |
| 2026-11-15 15:42 UTC | 600 / 180 | 180 / — | 600 / — | 181 / 180 |

## Recent changes

- [#1 TRR idle lifetime changed 2026-11-16](https://github.com/acreskeyMoz/trr-doh-monitor/issues/1)
