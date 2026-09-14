# SPEC Traceability: Isolation and Evaluation Gap

| Requirement | Implementation | Verification |
| --- | --- | --- |
| §4.2 / §18.3 ownership | Existing repositories remain account-scoped; HTTP matrix exercises every student-owned resource | `backend/tests/test_cross_user_isolation.py` |
| NFR-01-AC01–AC04 | Two authenticated principals cannot read or mutate each other’s tasks, availability, sessions, proposals, progress, or account records | `backend/tests/test_cross_user_isolation.py` |
| §16.1–§16.2 evaluation records | Export joins persisted adaptive predictions to account-scoped session outcomes; pending actuals remain `null` | `backend/src/studyflow/cli/export_evaluation.py` |
| §16.3 metrics | Export calculates per-participant sample count, MAE, signed bias, and MAE reduction through the shared comparison metric implementation | `backend/src/studyflow/evaluation/comparison.py` |
| §24.1 evaluation resources | Repeatable seed creates five pseudonymous participants with tasks, schedules, outcomes, predictions, and pending records | `backend/benchmarks/seed_evaluation.py` |
| §24.3–§24.4 export | JSON/CSV export is deterministic except for `exported_at` and excludes direct PII/raw UUIDs | `backend/tests/test_evaluation_export.py` |
| §27 completion | Dedicated isolation and export tests provide the missing automated evidence | Focused backend test commands above |
