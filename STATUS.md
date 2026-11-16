# TRR DoH monitor status

Updated 2026-11-16 09:52 UTC. Last request probe: 2026-11-16 09:52 UTC. Last idle lifetime run: 2026-11-16 07:26 UTC.

✅ as expected, ⚠️ some queries affected, ❌ all queries affected or check failed.

## Request series and 20s idle

| provider | h2 failures | h2 reconnects | h2 idle | h3 | h3 failures | h3 reconnects | h3 idle | since |
|---|---|---|---|---|---|---|---|---|
| cloudflare | ✅ | ✅ 0 | ✅ | advertised | ✅ | ✅ 0 | ✅ | 2026-11-15 15:19 UTC |
| nextdns | ✅ | ✅ 0 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC |
| cira | ✅ | ⚠️ 43 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC (new value seen 1×) |
| wikimedia | ✅ | ✅ 0 | ✅ | no | — | — | — | 2026-11-15 15:19 UTC |
| quad9 | ✅ | ✅ 0 | ✅ | advertised | ✅ | ✅ 0 | ✅ | 2026-11-15 15:19 UTC |

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
