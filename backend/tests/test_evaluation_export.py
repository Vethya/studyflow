"""Tests for evaluation export CLI and pseudonymization per SPEC §24.4."""

import csv
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from studyflow.cli.export_evaluation import (
    extract_evaluation_records,
    format_as_csv,
    pseudonymize_id,
    run_export,
)
from studyflow.database import Base, Database
from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.availability import AvailabilityWindow, UnavailablePeriod
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    ScheduleProposal,
    StudySession,
    StudySessionOutcome,
)
from studyflow.database.models.tasks import AcademicTask, AdaptiveEstimationPrediction


def test_pseudonymize_id_is_deterministic_and_masks_id() -> None:
    uid = uuid4()
    code1 = pseudonymize_id(uid, prefix="PARTICIPANT")
    code2 = pseudonymize_id(uid, prefix="PARTICIPANT")
    assert code1 == code2
    assert code1.startswith("PARTICIPANT-")
    assert str(uid) not in code1


def test_format_as_csv_matches_header_width_for_tasks_without_sessions() -> None:
    csv_text = format_as_csv(
        [
            {
                "participant_code": "PARTICIPANT-abc",
                "tasks": [
                    {
                        "task_code": "TASK-abc",
                        "category": "assignment",
                        "priority": "medium",
                        "original_estimate_minutes": 60,
                        "adaptive_estimate_minutes": None,
                        "planned_duration_minutes": 60,
                        "planned_source": "original",
                        "created_at": "2026-01-01T00:00:00+00:00",
                        "deadline_at": "2026-01-08T00:00:00+00:00",
                        "completed_at": None,
                    }
                ],
                "sessions": [],
            }
        ]
    )
    rows = list(csv.reader(csv_text.splitlines()))
    assert len(rows) == 2
    assert len(rows[0]) == 25
    assert len(rows[1]) == len(rows[0])


@pytest.mark.anyio
async def test_extract_evaluation_records_strips_pii() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()

    try:
        now = datetime.now(UTC).replace(microsecond=0)
        account_id = uuid4()

        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            account = StudentAccount(
                id=account_id,
                email="test_student@example.com",
                name="Alice RealName",
                password_hash="argon2id$hashedsecret",
                email_verified_at=now,
                timezone="America/New_York",
                preferred_session_length_minutes=60,
                minimum_break_minutes=10,
                created_at=now,
                updated_at=now,
            )
            session.add(account)

            task = AcademicTask(
                id=uuid4(),
                account_id=account_id,
                title="Physics Homework 1",
                category="assignment",
                priority="high",
                course="PHYS-101",
                notes="Secret notes",
                deadline_at=now + timedelta(days=5),
                original_estimate_minutes=120,
                adaptive_estimate_minutes=150,
                planned_source="adaptive",
                planned_duration_minutes=150,
                estimate_frozen_at=now,
                completed_at=now + timedelta(days=2),
                created_at=now,
                updated_at=now,
            )
            session.add(task)
            session.add(
                AdaptiveEstimationPrediction(
                    task_id=task.id,
                    account_id=account_id,
                    category="assignment",
                    original_minutes=120,
                    predicted_minutes=150,
                    correction_factor=1.25,
                    history_scope="overall",
                    history_count=5,
                    exposed=True,
                    created_at=now,
                )
            )

            proposal = ScheduleProposal(
                id=uuid4(),
                account_id=account_id,
                kind="generation",
                status="feasible",
                input_fingerprint="a" * 64,
                created_at=now,
            )
            session.add(proposal)
            await session.flush()

            session_record = StudySession(
                id=uuid4(),
                account_id=account_id,
                task_id=task.id,
                proposal_id=proposal.id,
                starts_at=now + timedelta(hours=1),
                ends_at=now + timedelta(hours=2),
                planned_duration_minutes=60,
            )
            session.add(session_record)
            await session.flush()

            outcome = StudySessionOutcome(
                session_id=session_record.id,
                kind="completed",
                actual_minutes=65,
                remaining_minutes=0,
                recorded_at=now + timedelta(hours=2),
            )
            session.add(outcome)

            accepted_session = StudySession(
                id=uuid4(),
                account_id=account_id,
                task_id=task.id,
                proposal_id=None,
                starts_at=now + timedelta(hours=3),
                ends_at=now + timedelta(hours=4),
                planned_duration_minutes=60,
            )
            session.add(accepted_session)

        async with database.transaction() as session:
            records = await extract_evaluation_records(session, target_account_id=account_id)
            assert len(records) == 1
            rec = records[0]

            # Verify PII is NOT in record
            raw_json = json.dumps(rec)
            assert "test_student@example.com" not in raw_json
            assert "Alice RealName" not in raw_json
            assert "argon2id" not in raw_json

            # Verify structured technical metrics
            assert rec["participant_code"].startswith("PARTICIPANT-")
            assert rec["tasks_count"] == 1
            assert rec["completed_tasks_count"] == 1
            assert len(rec["tasks"]) == 1
            assert rec["tasks"][0]["category"] == "assignment"
            assert rec["tasks"][0]["original_estimate_minutes"] == 120
            assert rec["tasks"][0]["adaptive_estimate_minutes"] == 150
            assert rec["tasks"][0]["planned_duration_minutes"] == 150
            assert len(rec["evaluation_records"]) == 1
            assert rec["evaluation_records"][0]["actual_minutes"] == 65
            assert rec["evaluation_records"][0]["eligible"] is True
            assert rec["evaluation_metrics"]["sample_count"] == 1
            assert rec["evaluation_metrics"]["original_mae"] == 55.0
            assert rec["evaluation_metrics"]["adaptive_mae"] == 85.0

            assert len(rec["sessions"]) == 2
            # First session is associated with proposal and is not yet accepted
            assert rec["sessions"][0]["proposal_code"].startswith("PROP-")
            assert rec["sessions"][0]["is_accepted"] is False
            assert rec["sessions"][0]["outcome"]["kind"] == "completed"
            assert rec["sessions"][0]["outcome"]["actual_minutes"] == 65
            # Second session is an accepted session with no proposal_id
            assert rec["sessions"][1]["proposal_code"] is None
            assert rec["sessions"][1]["is_accepted"] is True
            assert rec["sessions"][1]["outcome"] is None

            # Test CSV formatting
            csv_text = format_as_csv(records)
            assert "participant_code,task_code,category" in csv_text
            assert "session_code,proposal_code,is_accepted" in csv_text
            assert rec["participant_code"] in csv_text
            assert "outcome_kind,actual_minutes,remaining_minutes" in csv_text
            assert "completed" in csv_text
            assert "65" in csv_text
            assert "true" in csv_text
            assert "false" in csv_text
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_extract_evaluation_records_has_stable_tie_breakers() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        now = datetime(2026, 1, 1, tzinfo=UTC)
        account_id = uuid4()
        task_ids: tuple[UUID, ...] = tuple(sorted((uuid4(), uuid4())))
        proposal_id = uuid4()
        session_ids = (
            UUID("00000000-0000-0000-0000-000000000001"),
            UUID("00000000-0000-0000-0000-000000000002"),
        )

        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=account_id,
                    email="stable@example.com",
                    name="Stable Export",
                    password_hash="hash",
                    email_verified_at=now,
                    timezone="UTC",
                    created_at=now,
                    updated_at=now,
                )
            )
            session.add_all(
                [
                    AcademicTask(
                        id=task_ids[1],
                        account_id=account_id,
                        title="Task 2",
                        category="reading",
                        priority="medium",
                        course=None,
                        notes=None,
                        deadline_at=now + timedelta(days=7),
                        original_estimate_minutes=60,
                        adaptive_estimate_minutes=None,
                        planned_source="original",
                        planned_duration_minutes=60,
                        estimate_frozen_at=None,
                        completed_at=None,
                        created_at=now,
                        updated_at=now,
                    ),
                    AcademicTask(
                        id=task_ids[0],
                        account_id=account_id,
                        title="Task 1",
                        category="reading",
                        priority="medium",
                        course=None,
                        notes=None,
                        deadline_at=now + timedelta(days=7),
                        original_estimate_minutes=60,
                        adaptive_estimate_minutes=None,
                        planned_source="original",
                        planned_duration_minutes=60,
                        estimate_frozen_at=None,
                        completed_at=None,
                        created_at=now,
                        updated_at=now,
                    ),
                    ScheduleProposal(
                        id=proposal_id,
                        account_id=account_id,
                        kind="generation",
                        status="feasible",
                        input_fingerprint="b" * 64,
                        created_at=now,
                    ),
                    AvailabilityWindow(
                        id=uuid4(),
                        account_id=account_id,
                        weekday=0,
                        local_start_time=datetime.min.time().replace(hour=9),
                        local_end_time=datetime.min.time().replace(hour=17),
                        crosses_midnight=False,
                    ),
                    UnavailablePeriod(
                        id=uuid4(),
                        account_id=account_id,
                        starts_at=now + timedelta(days=2),
                        ends_at=now + timedelta(days=2, hours=1),
                        reason="first",
                    ),
                    UnavailablePeriod(
                        id=uuid4(),
                        account_id=account_id,
                        starts_at=now + timedelta(days=2),
                        ends_at=now + timedelta(days=2, hours=1),
                        reason="second",
                    ),
                ]
            )
            await session.flush()
            session.add_all(
                [
                    ProposalTaskAllocation(
                        proposal_id=proposal_id,
                        task_id=task_ids[1],
                        deadline_at=now + timedelta(days=7),
                        required_minutes=60,
                        scheduled_minutes=60,
                        unscheduled_minutes=0,
                        raw_calendar_capacity_minutes=480,
                        available_minutes_before_deadline=60,
                        shortfall_minutes=0,
                    ),
                    ProposalTaskAllocation(
                        proposal_id=proposal_id,
                        task_id=task_ids[0],
                        deadline_at=now + timedelta(days=7),
                        required_minutes=60,
                        scheduled_minutes=60,
                        unscheduled_minutes=0,
                        raw_calendar_capacity_minutes=480,
                        available_minutes_before_deadline=60,
                        shortfall_minutes=0,
                    ),
                    StudySession(
                        id=session_ids[1],
                        account_id=account_id,
                        task_id=task_ids[1],
                        proposal_id=proposal_id,
                        starts_at=now + timedelta(days=1),
                        ends_at=now + timedelta(days=1, hours=1),
                        planned_duration_minutes=60,
                    ),
                    StudySession(
                        id=session_ids[0],
                        account_id=account_id,
                        task_id=task_ids[0],
                        proposal_id=proposal_id,
                        starts_at=now + timedelta(days=1),
                        ends_at=now + timedelta(days=1, hours=1),
                        planned_duration_minutes=60,
                    ),
                    AdaptiveEstimationPrediction(
                        task_id=task_ids[1],
                        account_id=account_id,
                        category="reading",
                        original_minutes=60,
                        predicted_minutes=70,
                        correction_factor=1.166,
                        history_scope="overall",
                        history_count=5,
                        exposed=False,
                        created_at=now,
                    ),
                    AdaptiveEstimationPrediction(
                        task_id=task_ids[0],
                        account_id=account_id,
                        category="reading",
                        original_minutes=60,
                        predicted_minutes=70,
                        correction_factor=1.166,
                        history_scope="overall",
                        history_count=5,
                        exposed=False,
                        created_at=now,
                    ),
                ]
            )

        async with database.transaction() as session:
            first = await extract_evaluation_records(session, target_account_id=account_id)
            second = await extract_evaluation_records(session, target_account_id=account_id)

        assert first == second
        record = first[0]
        expected_task_codes = [pseudonymize_id(task_id, "TASK") for task_id in task_ids]
        assert [task["task_code"] for task in record["tasks"]] == expected_task_codes
        assert [
            allocation["task_code"] for allocation in record["proposals"][0]["allocations"]
        ] == expected_task_codes
        assert [session["task_code"] for session in record["sessions"]] == expected_task_codes
        assert [
            evaluation["task_code"] for evaluation in record["evaluation_records"]
        ] == expected_task_codes
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_run_export_writes_json_and_csv_files(tmp_path: Path) -> None:
    db_path = tmp_path / "test_eval.db"
    db_url = f"sqlite+aiosqlite:///{db_path}"
    database = Database(db_url)
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=uuid4(),
                    email="student1@example.com",
                    name="Student One",
                    password_hash="hash",
                    email_verified_at=datetime.now(UTC),
                    timezone="UTC",
                )
            )
    finally:
        await database.stop()

    json_file = str(tmp_path / "out.json")
    csv_file = str(tmp_path / "out.csv")

    json_out = await run_export(database_url=db_url, output_path=json_file, output_format="json")
    assert '"participant_count": 1' in json_out
    assert (tmp_path / "out.json").exists()

    csv_out = await run_export(database_url=db_url, output_path=csv_file, output_format="csv")
    assert "participant_code" in csv_out
    assert (tmp_path / "out.csv").exists()
