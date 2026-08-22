from datetime import UTC, datetime
from uuid import uuid4

import pytest

from studyflow.accounts.repositories import SqlAlchemyAccountProfileRepository
from studyflow.database import Base, Database
from studyflow.database.models import StudentAccount


@pytest.mark.anyio
async def test_profile_repository_cannot_read_or_update_another_account() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    first_id = uuid4()
    second_id = uuid4()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add_all(
                [
                    StudentAccount(
                        id=first_id,
                        email="first@example.com",
                        name="First Student",
                        password_hash="$argon2id$first",
                        email_verified_at=datetime.now(UTC),
                        timezone="UTC",
                    ),
                    StudentAccount(
                        id=second_id,
                        email="second@example.com",
                        name="Second Student",
                        password_hash="$argon2id$second",
                        email_verified_at=datetime.now(UTC),
                        timezone="UTC",
                    ),
                ]
            )
        repository = SqlAlchemyAccountProfileRepository(database)

        updated = await repository.update_name(first_id, "Updated First")

        assert updated is not None and updated.name == "Updated First"
        assert (await repository.get(second_id)).name == "Second Student"  # type: ignore[union-attr]
        assert await repository.get(uuid4()) is None
    finally:
        await database.stop()
