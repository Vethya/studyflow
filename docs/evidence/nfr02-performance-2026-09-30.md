# NFR-02 performance evidence

Status: **PASS**
Measured at: `2026-09-30T06:52:39.433056+00:00`
Target Git revision: `3d1d40189882e44354eea7c421fe5e03098d2e74`
Benchmark checkout revision: `963cbeb68722f06eb388f3044f60067c1d5b5ce6`

## Test conditions

- Environment: local warm stack; code tree matches submission `dev` at the target revision
- Frontend URL: `http://localhost:3000`
- Database target: `127.0.0.1/studyflow`
- Machine: Darwin 27.0.0 (arm64), 12 logical CPUs
- Browser: Google Chrome 154.0.8037.92, user agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36`
- Viewport: 1440x900 CSS pixels
- Readiness check: `0.0176s` before seeding and measurement
- Warm-up: one unmeasured run per endpoint and page
- Measured runs: `20` per endpoint and page
- Seeded workload: one student, 50 active tasks, up to 250 sessions, 16-week horizon,
  50 unavailable periods

## Main-page usability

Measurement runs from page navigation until the main heading is visible, the
expected seeded API data has arrived, and loading placeholders have disappeared.

| Page | Min | Median | Max | p95 | Limit | Result |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| Dashboard | 0.2612s | 0.2863s | 0.3112s | 0.3037s | < 3.0s | PASS |
| Tasks | 0.1871s | 0.2036s | 0.2253s | 0.2250s | < 3.0s | PASS |
| Availability | 0.1781s | 0.1975s | 0.2758s | 0.2260s | < 3.0s | PASS |
| Schedule | 0.1924s | 0.2089s | 0.2987s | 0.2620s | < 3.0s | PASS |
| Progress | 0.1629s | 0.1731s | 0.1899s | 0.1785s | < 3.0s | PASS |

## HTTP and schedule-generation response times

| Endpoint | Scenario | Min | Median | Max | p95 | Limit | Result |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| Tasks List (50 tasks) | - | 0.0084s | 0.0097s | 0.0132s | 0.0120s | < 3.0s | PASS |
| Availability Windows | - | 0.0063s | 0.0103s | 0.0135s | 0.0128s | < 3.0s | PASS |
| Unavailable Periods (50 gaps) | - | 0.0054s | 0.0069s | 0.0097s | 0.0086s | < 3.0s | PASS |
| Active Study Sessions (250 sessions) | - | 0.0085s | 0.0109s | 0.0171s | 0.0170s | < 3.0s | PASS |
| Current Schedule Proposal | - | 0.0151s | 0.0170s | 0.0228s | 0.0220s | < 3.0s | PASS |
| Effort Progress | - | 0.0161s | 0.0185s | 0.0227s | 0.0216s | < 3.0s | PASS |
| Schedule Generation (Feasible, 50 tasks) | feasible | 0.1313s | 0.1343s | 0.1718s | 0.1680s | < 5.0s | PASS |
| Schedule Generation (Overloaded, 50 tasks) | overloaded | 0.1290s | 0.1366s | 0.1694s | 0.1686s | < 5.0s | PASS |

The HTTP benchmark also fails the run when a measured request returns a server error or times out.
The feasible and overloaded schedule rows use the same seeded workload.

The hosted dev readiness endpoints returned HTTP 503 during this run, so this
report is local verification and does not replace deployment-specific evidence.
