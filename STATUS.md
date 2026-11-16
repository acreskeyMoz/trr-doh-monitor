# TRR DoH monitor status

Updated 2026-11-16 17:53 UTC. Last request probe: 2026-11-16 15:56 UTC. Last idle lifetime run: 2026-11-16 07:26 UTC.

✅ as expected, ⚠️ some queries affected, ❌ all queries affected or check failed. Values are from the latest run; "since" is when the confirmed state began.

## Request series and 20s idle

| provider | h2 failures | h2 reconnects | h2 idle | h3 | h3 failures | h3 reconnects | h3 idle | since |
|---|---|---|---|---|---|---|---|---|
| cloudflare | ✅ 0 | ✅ 0 | ✅ | advertised | ✅ 0 | ✅ 0 | ✅ | 2026-11-15 15:19 UTC |
| nextdns | ✅ 0 | ✅ 0 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC |
| cira | ✅ 0 | ✅ 0 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC → **changed 2026-11-16 15:56 UTC, not yet confirmed (1 run)** |
| wikimedia | ✅ 0 | ✅ 0 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC |
| quad9 | ✅ 0 | ✅ 0 | ✅ | advertised | ⚠️ 3 | ✅ 0 | ✅ | 2026-11-15 15:19 UTC → **changed 2026-11-16 15:56 UTC, not yet confirmed (1 run)** |

## Timing

Response time per query in the latest run: `█` up to the median, `▒` up to the 90th percentile, on one scale for all providers. Trend: each run's median h2 response time over the last 7 days, scaled per provider. Connect: per new connection (h2: TCP + TLS; h3: QUIC handshake).

| provider | h2 response | h3 response | h2 trend, 7 days | connect h2 / h3 |
|---|---|---|---|---|
| cloudflare | `███▒░░░░░░░░░░░░░░░░` 3 / 4 ms | `█████▒░░░░░░░░░░░░░░` 5 / 6 ms | — | 8 + 9 ms / 10 ms |
| nextdns | `███░░░░░░░░░░░░░░░░░` 3 / 3 ms | — | — | 4 + 7 ms / — |
| cira | `███████████████████▒` 20 / 21 ms | — | — | 21 + 23 ms / — |
| wikimedia | `█▒▒░░░░░░░░░░░░░░░░░` 1 / 3 ms | — | — | 2 + 6 ms / — |
| quad9 | `██░░░░░░░░░░░░░░░░░░` 2 / 2 ms | `█▒░░░░░░░░░░░░░░░░░░` 1 / 2 ms | — | 3 + 6 ms / 21 ms |

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
