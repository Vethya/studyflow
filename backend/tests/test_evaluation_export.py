"""Tests for evaluation export CLI and pseudonymization per SPEC §24.4."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest

from studyflow.cli.export_evaluation import (
    extract_evaluation_records,
    format_as_csv,
    pseudonymize_id,
    run_export,
)
from studyflow.database import Base, Database
from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.scheduling import (
    ScheduleProposal,
    StudySession,
    StudySessionOutcome,
)
from studyflow.database.models.tasks import AcademicTask


def test_pseudonymize_id_is_deterministic_and_masks_id() -> None:
    uid = uuid4()
    code1 = pseudonymize_id(uid, prefix="PARTICIPANT")
    code2 = pseudonymize_id(uid, prefix="PARTICIPANT")
    assert code1 == code2
    assert code1.startswith("PARTICIPANT-")
    assert str(uid) not in code1


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
