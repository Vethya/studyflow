# Scheduler performance gate

Run from `backend/`:

```console
uv run python benchmarks/scheduler_performance.py
```

The gate performs one warm-up and 20 measured runs for both the feasible and
overloaded NFR-02 scenarios. Each scenario has one student, 50 active tasks,
250 sessions, a 16-week horizon, and 50 unavailable periods. Passing requires
the 95th percentile to remain below five seconds. Machine and revision details
belong with recorded benchmark results because this is a warm local gate, not a
cross-machine latency comparison.
