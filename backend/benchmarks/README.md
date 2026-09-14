# NFR-02 performance benchmarks

Run from `backend/`:

```console
uv run python benchmarks/scheduler_performance.py --runs 20 --threshold-seconds 5.0
```

The gate performs one warm-up and 20 measured runs for both the feasible and
overloaded NFR-02 scenarios. Each scenario has one student, 50 active tasks,
250 sessions, a 16-week horizon, and 50 unavailable periods. Passing requires
the 95th percentile to remain below five seconds. Machine and revision details
belong with recorded benchmark results because this is a warm local gate, not a
cross-machine latency comparison.

The HTTP benchmark measures the API through the frontend origin and can write
raw samples for the evidence report:

```console
NFR02_BENCHMARK_EMAIL='<existing-dev-account-email>' \
NFR02_BENCHMARK_PASSWORD='<existing-dev-account-password>' \
uv run python benchmarks/http_performance.py \
  --base-url https://<dev-frontend-url> \
  --runs 20 \
  --json-output /tmp/nfr02-http.json
```

The overloaded HTTP request retains the complete seeded workload and overrides
five task deadlines to approximately two hours after the benchmark starts.
Those five tasks require more work than can fit before their deadlines, so the
API can return a proven overload without changing production code or reducing
the required 50-task/250-session dataset.

For the complete dev-environment run, use the repository-level runner from the
repository root:

```console
NFR02_DATABASE_URL='postgresql+psycopg://<dev-database-url>' \
NFR02_BENCHMARK_EMAIL='<existing-dev-account-email>' \
NFR02_BENCHMARK_PASSWORD='<existing-dev-account-password>' \
NFR02_DEPLOYED_REVISION='<git-sha-deployed-at-the-dev-frontend-url>' \
python3 scripts/run_nfr02_evidence.py \
  --base-url https://<dev-frontend-url>
```

The runner requires the dev deployment to already be warm, seeds the supplied
dev database, runs the HTTP and browser measurements, and writes a Markdown
report under `docs/evidence/`. The seeder preserves the selected account and
stops if it contains unrelated student data. To reuse an account that already
contains only the NFR-02 footprint, preview and then explicitly reset it:

```console
uv run python benchmarks/seed_nfr02.py \
  --email '<existing-dev-account-email>' \
  --reset-existing \
  --dry-run

uv run python benchmarks/seed_nfr02.py \
  --email '<existing-dev-account-email>' \
  --reset-existing
```

The reset preserves the account credentials and profile, deletes only a
verified NFR-02 footprint, and reseeds the exact workload. It can recover when
the benchmark proposal was manually deleted or replaced by an API-generated
proposal, using the remaining benchmark markers and exact task allocations. It
aborts without changes when it finds unmarked tasks, sessions, availability, or
proposals.
It never falls back to the local `backend/.env` database URL.
The selected account keeps its own IANA timezone, which the HTTP benchmark
records in the evidence report. It must use the workload-defining scheduling
preferences: 60-minute preferred sessions, a 10-minute minimum break, and
confirmed timezone availability.

To remove the verified benchmark footprint without changing the account or
checking its scheduling preferences, use the explicit reset-only mode:

```console
uv run python benchmarks/seed_nfr02.py \
  --email '<existing-dev-account-email>' \
  --reset-existing \
  --reset-only \
  --dry-run

uv run python benchmarks/seed_nfr02.py \
  --email '<existing-dev-account-email>' \
  --reset-existing \
  --reset-only
```

The evidence runner also requires the Git SHA deployed at the target frontend
URL so the report identifies the code that was measured.
