# NFR-02 performance evidence

Status: **PASS**
Measured at: `2026-09-14T08:35:32.253379+00:00`
Git revision: `9aa8f7092477d86ef69d73441da6ea02467625d4`

## Test conditions

- Environment: dev only
- Frontend URL: `https://studyflow-gdwih24yo-vethyas-projects.vercel.app`
- Database target: `ep-withered-morning-az547spt-pooler.c-3.ap-southeast-1.aws.neon.tech/studyflow-dev`
- Machine: Darwin 25.6.0 (arm64), 12 logical CPUs
- Browser: Google Chrome 152.0.7977.84, user agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36`
- Viewport: 1440x900 CSS pixels
- Readiness check: `0.2918s` before seeding and measurement
- Warm-up: one unmeasured run per endpoint and page
- Measured runs: `20` per endpoint and page
- Seeded workload: one student, 50 active tasks, up to 250 sessions, 16-week horizon,
  50 unavailable periods

## Main-page usability

Measurement runs from page navigation until the main heading is visible, the
expected seeded API data has arrived, and loading placeholders have disappeared.

| Page | Min | Median | Max | p95 | Limit | Result |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| Dashboard | 0.7959s | 0.9746s | 1.3477s | 1.1720s | < 3.0s | PASS |
| Tasks | 0.3197s | 0.4002s | 0.4800s | 0.4790s | < 3.0s | PASS |
| Availability | 0.3093s | 0.3977s | 0.5860s | 0.4764s | < 3.0s | PASS |
| Schedule | 0.7130s | 0.8970s | 1.6298s | 1.4130s | < 3.0s | PASS |
| Progress | 0.6997s | 0.9007s | 1.6225s | 1.0944s | < 3.0s | PASS |

## HTTP and schedule-generation response times

| Endpoint | Scenario | Min | Median | Max | p95 | Limit | Result |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| Tasks List (50 tasks) | - | 0.1056s | 0.1250s | 0.5463s | 0.2336s | < 3.0s | PASS |
| Availability Windows | - | 0.0975s | 0.1081s | 0.6634s | 0.1704s | < 3.0s | PASS |
| Unavailable Periods (50 gaps) | - | 0.0950s | 0.1536s | 0.4386s | 0.4096s | < 3.0s | PASS |
| Active Study Sessions (250 sessions) | - | 0.1072s | 0.1617s | 0.2743s | 0.2159s | < 3.0s | PASS |
| Current Schedule Proposal | - | 0.1578s | 0.2322s | 0.5155s | 0.4622s | < 3.0s | PASS |
| Effort Progress | - | 0.1528s | 0.2139s | 0.3966s | 0.3846s | < 3.0s | PASS |
| Schedule Generation (Feasible, 50 tasks) | feasible | 2.2562s | 2.8902s | 3.9056s | 3.7429s | < 5.0s | PASS |
| Schedule Generation (Overloaded, 50 tasks) | overloaded | 2.2160s | 2.5598s | 3.3714s | 3.1386s | < 5.0s | PASS |

The HTTP benchmark also fails the run when a measured request returns a server error or times out.
The feasible and overloaded schedule rows use the same seeded workload.
