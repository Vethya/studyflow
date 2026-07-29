from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from studyflow.database import Base, Database
from studyflow.database.models import StudentAccount
from studyflow.tasks.repositories import SqlAlchemyAcademicTaskRepository
from studyflow.tasks.service import NewAcademicTask, TaskCategory, TaskFilters, TaskPriority


@pytest.mark.anyio
async def test_task_repository_scopes_create_list_and_get_to_owner() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    other_id = uuid4()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add_all(
                [
                    StudentAccount(
                        id=account_id,
                        email="student@example.com",
                        name="Student",
                        password_hash="$argon2id$hash",
                        email_verified_at=datetime.now(UTC),
                        timezone="UTC",
                    ),
                    StudentAccount(
                        id=other_id,
                        email="other@example.com",
                        name="Other",
                        password_hash="$argon2id$hash",
                        email_verified_at=datetime.now(UTC),
                        timezone="UTC",
                    ),
                ]
            )
        repository = SqlAlchemyAcademicTaskRepository(database)
        created = await repository.create(
            account_id,
            NewAcademicTask(
                "Read chapter 4",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                datetime.now(UTC) + timedelta(days=1),
                90,
            ),
        )
        later = await repository.create(
            account_id,
            NewAcademicTask(
                "Submit project",
                TaskCategory.PROJECT,
                TaskPriority.HIGH,
                "Algorithms",
                None,
                datetime.now(UTC) + timedelta(days=2),
                180,
            ),
        )

        assert [task.id for task in await repository.list(account_id)] == [created.id, later.id]
        assert [
            task.id
            for task in await repository.list(
                account_id, TaskFilters(course="Algorithms", priority=TaskPriority.HIGH)
            )
        ] == [later.id]
        assert await repository.list(other_id) == []
        assert await repository.get(other_id, created.id) is None
        assert (await repository.get(account_id, created.id)).planned_duration_minutes == 90  # type: ignore[union-attr]
    finally:
        await database.stop()
