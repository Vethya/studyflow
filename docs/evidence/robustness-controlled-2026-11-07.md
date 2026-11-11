# Schedule robustness with controlled load (2026-11-07)

macOS-27.2-arm64-arm-64bit-Mach-O, arm64, Python 3.13.18, OR-Tools 9.15.6755, git 3c8a7c121

## Part 1: overload audit of the 160 technical-note scenarios

Deadline load = max over deadlines of (work due + lower-bound breaks) / capacity before that deadline, using the original estimates (perfect estimates). Above 1 proves overload. Engine = `solve_with_overload` status on the same instance (from the first robustness run).

| Sessions | Tasks | Load | Scenarios | Proven overloaded | Engine: overload | Engine: no schedule | Median deadline load |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mixed | <20 | heavy | 10 | 10 | 4 | 6 | 2.29 |
| mixed | <20 | light | 10 | 6 | 6 | 3 | 1.21 |
| mixed | 20-49 | heavy | 10 | 10 | 3 | 7 | 1.83 |
| mixed | 20-49 | light | 10 | 3 | 2 | 2 | 0.89 |
| mixed | 50+ | heavy | 20 | 20 | 10 | 10 | 1.96 |
| mixed | 50+ | light | 20 | 6 | 5 | 2 | 0.93 |
| equal | <20 | heavy | 10 | 10 | 10 | 0 | 2.09 |
| equal | <20 | light | 10 | 3 | 5 | 0 | 0.83 |
| equal | 20-49 | heavy | 10 | 10 | 10 | 0 | 1.99 |
| equal | 20-49 | light | 10 | 4 | 5 | 0 | 0.87 |
| equal | 50+ | heavy | 20 | 20 | 20 | 0 | 1.89 |
| equal | 50+ | light | 20 | 13 | 20 | 0 | 1.58 |

Proven overloaded with perfect estimates: 115 of 160.

Mixed-length, 50+ tasks, no schedule within 4 s: 12 instances; 11 of them are proven overloaded (deadline loads: 1.10, 0.97, 1.70, 1.85, 2.40, 1.77, 1.68, 3.28, 2.00, 1.87, 1.75, 1.95).

## Part 2: controlled-load experiment

- Scenarios: 2 session-length variants x task counts x 10 seeds per cell, shared by A/B/C. Load = deadline load of the true-median plan (original x 1.3, after rounding, plus lower-bound breaks).
- Error model: true = original x LogNormal(median=1.3, sigma=s), 50 samples per schedule, seed 20261108.
- A = original, B = original x 1.3, C = original x 1.3 x exp(0.674 s).
- Failed = no schedule returned; all its tasks counted as missed.
- Unused = planned minutes not needed, as % of true work.
- Skipped 43 scenarios whose load could not be set within 0.03 of the target: uniform 10 tasks: 3, uniform 25 tasks: 14, uniform 50 tasks: 26.

| Load | s | Tasks | Cond | Tasks missed % | Unused % of true work | Failed | Overload plans |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 60% | 0.3 | 10 | A | 15.5 | 2.5 | 0/19 | 0 |
| 60% | 0.3 | 10 | B | 7.9 | 10.0 | 0/19 | 0 |
| 60% | 0.3 | 10 | C | 2.4 | 24.2 | 0/19 | 0 |
| 60% | 0.3 | 25 | A | 19.9 | 7.1 | 0/15 | 0 |
| 60% | 0.3 | 25 | B | 9.3 | 14.3 | 0/15 | 0 |
| 60% | 0.3 | 25 | C | 1.9 | 27.2 | 0/15 | 2 |
| 60% | 0.3 | 50 | A | 27.0 | 2.0 | 0/10 | 0 |
| 60% | 0.3 | 50 | B | 16.9 | 9.6 | 0/10 | 0 |
| 60% | 0.3 | 50 | C | 3.1 | 23.1 | 0/10 | 0 |
| 60% | 0.5 | 10 | A | 14.8 | 5.9 | 0/19 | 0 |
| 60% | 0.5 | 10 | B | 10.3 | 14.4 | 0/19 | 0 |
| 60% | 0.5 | 10 | C | 8.6 | 35.7 | 1/19 | 5 |
| 60% | 0.5 | 25 | A | 17.5 | 9.3 | 0/15 | 0 |
| 60% | 0.5 | 25 | B | 10.4 | 17.0 | 0/15 | 0 |
| 60% | 0.5 | 25 | C | 2.0 | 37.8 | 0/15 | 3 |
| 60% | 0.5 | 50 | A | 23.1 | 5.1 | 0/10 | 0 |
| 60% | 0.5 | 50 | B | 16.0 | 13.3 | 0/10 | 0 |
| 60% | 0.5 | 50 | C | 2.6 | 35.9 | 0/10 | 0 |
| 75% | 0.3 | 10 | A | 22.6 | 2.3 | 0/18 | 0 |
| 75% | 0.3 | 10 | B | 12.6 | 9.8 | 0/18 | 0 |
| 75% | 0.3 | 10 | C | 9.8 | 21.0 | 1/18 | 8 |
| 75% | 0.3 | 25 | A | 24.9 | 5.4 | 0/15 | 0 |
| 75% | 0.3 | 25 | B | 11.6 | 12.5 | 0/15 | 0 |
| 75% | 0.3 | 25 | C | 15.0 | 22.1 | 2/15 | 4 |
| 75% | 0.3 | 50 | A | 35.3 | 2.0 | 0/10 | 0 |
| 75% | 0.3 | 50 | B | 21.8 | 9.6 | 0/10 | 0 |
| 75% | 0.3 | 50 | C | 13.5 | 20.9 | 1/10 | 0 |
| 75% | 0.5 | 10 | A | 21.2 | 5.7 | 0/18 | 0 |
| 75% | 0.5 | 10 | B | 15.2 | 14.5 | 0/18 | 0 |
| 75% | 0.5 | 10 | C | 22.7 | 27.1 | 3/18 | 15 |
| 75% | 0.5 | 25 | A | 22.1 | 8.0 | 0/15 | 0 |
| 75% | 0.5 | 25 | B | 13.3 | 15.6 | 0/15 | 0 |
| 75% | 0.5 | 25 | C | 23.4 | 28.0 | 3/15 | 12 |
| 75% | 0.5 | 50 | A | 29.8 | 5.2 | 0/10 | 0 |
| 75% | 0.5 | 50 | B | 20.7 | 13.6 | 0/10 | 0 |
| 75% | 0.5 | 50 | C | 51.8 | 17.8 | 5/10 | 3 |
| 90% | 0.3 | 10 | A | 32.5 | 2.4 | 0/20 | 0 |
| 90% | 0.3 | 10 | B | 20.3 | 9.1 | 1/20 | 9 |
| 90% | 0.3 | 10 | C | 19.0 | 16.9 | 2/20 | 18 |
| 90% | 0.3 | 25 | A | 30.6 | 4.3 | 0/16 | 0 |
| 90% | 0.3 | 25 | B | 21.0 | 10.6 | 1/16 | 6 |
| 90% | 0.3 | 25 | C | 24.6 | 18.0 | 3/16 | 13 |
| 90% | 0.3 | 50 | A | 31.1 | 29.4 | 0/14 | 3 |
| 90% | 0.3 | 50 | B | 24.5 | 34.3 | 1/14 | 4 |
| 90% | 0.3 | 50 | C | 38.8 | 37.5 | 5/14 | 9 |
| 90% | 0.5 | 10 | A | 29.4 | 6.0 | 0/20 | 0 |
| 90% | 0.5 | 10 | B | 24.2 | 13.5 | 1/20 | 9 |
| 90% | 0.5 | 10 | C | 27.8 | 23.0 | 3/20 | 17 |
| 90% | 0.5 | 25 | A | 26.7 | 7.2 | 0/16 | 0 |
| 90% | 0.5 | 25 | B | 22.7 | 13.7 | 1/16 | 6 |
| 90% | 0.5 | 25 | C | 26.8 | 24.8 | 3/16 | 13 |
| 90% | 0.5 | 50 | A | 27.1 | 29.9 | 0/14 | 3 |
| 90% | 0.5 | 50 | B | 24.7 | 35.1 | 1/14 | 4 |
| 90% | 0.5 | 50 | C | 34.2 | 41.9 | 4/14 | 10 |
