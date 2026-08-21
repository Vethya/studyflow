from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import CheckConstraint, DateTime, DefaultClause
from sqlalchemy.exc import IntegrityError

from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount


def test_academic_task_schema_preserves_owned_planning_inputs() -> None:
    table = Base.metadata.tables["academic_tasks"]

    assert set(table.columns.keys()) == {
        "id",
        "account_id",
        "title",
        "category",
        "priority",
        "course",
        "notes",
        "deadline_at",
        "original_estimate_minutes",
        "adaptive_estimate_minutes",
        "planned_source",
        "planned_duration_minutes",
        "estimate_frozen_at",
        "finished_early_at",
        "created_at",
        "updated_at",
    }
    ownership = next(iter(table.c.account_id.foreign_keys))
    assert ownership.target_fullname == "student_accounts.id"
    assert ownership.ondelete == "CASCADE"
    constraints = {
        constraint.name
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert {
        "ck_academic_tasks_category",
        "ck_academic_tasks_priority",
        "ck_academic_tasks_positive_estimates",
        "ck_academic_tasks_planned_duration_source",
        "ck_academic_tasks_title_required",
        "ck_academic_tasks_course_length",
        "ck_academic_tasks_notes_length",
    }.issubset(constraints)
    assert cast(DateTime, table.c.deadline_at.type).timezone is True
    assert cast(DateTime, table.c.estimate_frozen_at.type).timezone is True
    assert cast(DateTime, table.c.finished_early_at.type).timezone is True
    assert isinstance(table.c.priority.server_default, DefaultClause)
    assert isinstance(table.c.planned_source.server_default, DefaultClause)
    assert str(table.c.priority.server_default.arg) == "medium"
    assert str(table.c.planned_source.server_default.arg) == "original"


def test_task_deadline_history_is_owned_through_cascading_task() -> None:
    table = Base.metadata.tables["task_deadline_history"]

    assert set(table.columns.keys()) == {
        "id",
        "task_id",
        "previous_deadline_at",
        "new_deadline_at",
        "changed_at",
    }
    task_foreign_key = next(iter(table.c.task_id.foreign_keys))
    assert task_foreign_key.target_fullname == "academic_tasks.id"
    assert task_foreign_key.ondelete == "CASCADE"
    assert cast(DateTime, table.c.previous_deadline_at.type).timezone is True
    assert cast(DateTime, table.c.new_deadline_at.type).timezone is True
    assert cast(DateTime, table.c.changed_at.type).timezone is True


@pytest.mark.anyio
@pytest.mark.parametrize("title", ["   ", "\t\t", "\n\r", "\f\v"])
async def test_task_persistence_rejects_whitespace_only_titles(title: str) -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime.now(UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=account_id,
                    email="student@example.com",
                    name="Student",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
        async with database.transaction() as session:
            session.add(
                AcademicTask(
                    account_id=account_id,
                    title=title,
                    category="reading",
                    deadline_at=now + timedelta(days=1),
                    original_estimate_minutes=30,
                    planned_duration_minutes=30,
                )
            )
            with pytest.raises(IntegrityError):
                await session.flush()
    finally:
        await database.stop()
