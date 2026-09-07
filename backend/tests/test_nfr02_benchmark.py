"""Tests for NFR-02 dataset seeder and benchmark runner."""

import sys
from pathlib import Path

import pytest
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).parents[1]))

from benchmarks.http_performance import (
    percentile_95,
    run_http_benchmark,
)
from benchmarks.seed_nfr02 import (
    BENCHMARK_EMAIL,
    seed_nfr02_dataset,
)
from studyflow.database import Base, Database
from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.availability import AvailabilityWindow, UnavailablePeriod
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    ScheduleProposal,
    StudySession,
)
from studyflow.database.models.tasks import AcademicTask


def test_percentile_95_calculation() -> None:
    # 20 samples from 0.1 to 2.0
    samples = [i * 0.1 for i in range(1, 21)]
    p95 = percentile_95(samples)
    assert abs(p95 - 1.9) < 1e-5


@pytest.mark.anyio
async def test_run_http_benchmark_fails_on_unreachable_endpoint() -> None:
    # Point to a closed port / non-existent host
    exit_code = await run_http_benchmark(
        base_url="http://127.0.0.1:59999",
        runs=1,
    )
    assert exit_code == 1


@pytest.mark.anyio
async def test_seed_nfr02_dataset_creates_complete_spec_workload() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()

    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            account_id = await seed_nfr02_dataset(session)
            assert account_id is not None

        async with database.transaction() as session:
            # 1. Exactly 1 account
            account_stmt = select(StudentAccount).where(StudentAccount.id == account_id)
            accounts = (await session.execute(account_stmt)).scalars().all()
            assert len(accounts) == 1
            assert accounts[0].email == BENCHMARK_EMAIL

            # 2. Weekly Availability Windows (Mon-Fri)
            window_stmt = select(AvailabilityWindow).where(
                AvailabilityWindow.account_id == account_id
            )
            windows = (await session.execute(window_stmt)).scalars().all()
            assert len(windows) == 5

            # 3. Exactly 50 Unavailable Periods
            unavail_stmt = select(UnavailablePeriod).where(
                UnavailablePeriod.account_id == account_id
            )
            unavails = (await session.execute(unavail_stmt)).scalars().all()
            assert len(unavails) == 50

            # 4. Exactly 50 Active Academic Tasks
            tasks = (
                (
                    await session.execute(
                        select(AcademicTask).where(AcademicTask.account_id == account_id)
                    )
                )
                .scalars()
                .all()
            )
            assert len(tasks) == 50

            # 5. Exactly 250 Scheduled Study Sessions
            sessions = (
                (
                    await session.execute(
                        select(StudySession).where(StudySession.account_id == account_id)
                    )
                )
                .scalars()
                .all()
            )
            assert len(sessions) == 250

            proposals = (
                (
                    await session.execute(
                        select(ScheduleProposal).where(ScheduleProposal.account_id == account_id)
                    )
                )
                .scalars()
                .all()
            )
            assert len(proposals) == 1
            assert all(s.proposal_id == proposals[0].id for s in sessions)

            # Verify no sessions overlap with any unavailable periods and respect working hours
            for s in sessions:
                assert s.starts_at.weekday() < 5
                assert s.starts_at.hour >= 9
                assert s.ends_at.hour < 17 or (s.ends_at.hour == 17 and s.ends_at.minute == 0)
                for u in unavails:
                    assert not (s.starts_at < u.ends_at and s.ends_at > u.starts_at), (
                        f"Session {s.id} ({s.starts_at} - {s.ends_at}) overlaps "
                        f"unavailable {u.id} ({u.starts_at} - {u.ends_at})"
                    )

            # 6. Allocations for each task
            allocs = (
                (
                    await session.execute(
                        select(ProposalTaskAllocation).order_by(ProposalTaskAllocation.deadline_at)
                    )
                )
                .scalars()
                .all()
            )
            assert len(allocs) == 50
            for a in allocs:
                assert a.raw_calendar_capacity_minutes >= 2000
                assert a.available_minutes_before_deadline == a.scheduled_minutes
                assert a.shortfall_minutes == 0
            assert (
                allocs[0].raw_calendar_capacity_minutes < allocs[-1].raw_calendar_capacity_minutes
            )
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_run_http_benchmark_fails_on_server_or_client_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/auth/login":
            return httpx.Response(200, json={"csrf_token": "token"})
        # Return 404 for endpoints
        return httpx.Response(404, json={"detail": "Not Found"})

    transport = httpx.MockTransport(handler)

    class CustomAsyncClient(httpx.AsyncClient):
        def __init__(self, *args: object, **kwargs: object) -> None:
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", CustomAsyncClient)

    exit_code = await run_http_benchmark(
        base_url="http://testserver",
        runs=2,
    )
    assert exit_code == 1
