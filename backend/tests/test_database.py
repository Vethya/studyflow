from typing import cast

import pytest
from sqlalchemy import Table, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from studyflow.database import Base, Database


class ExampleRecord(Base):
    __tablename__ = "example_records"
    __table_args__ = (UniqueConstraint("name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]


@pytest.mark.anyio
async def test_successful_database_transaction_is_committed() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()

    try:
        async with database.transaction() as session:
            await session.execute(text("CREATE TABLE messages (body TEXT NOT NULL)"))
            await session.execute(text("INSERT INTO messages (body) VALUES ('committed')"))

        async with database.transaction() as session:
            result = await session.execute(text("SELECT body FROM messages"))

        assert result.scalar_one() == "committed"
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_failed_database_transaction_is_rolled_back() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()

    try:
        async with database.transaction() as session:
            await session.execute(text("CREATE TABLE messages (body TEXT NOT NULL)"))

        with pytest.raises(RuntimeError, match="abort transaction"):
            async with database.transaction() as session:
                await session.execute(text("INSERT INTO messages (body) VALUES ('not committed')"))
                raise RuntimeError("abort transaction")

        async with database.transaction() as session:
            result = await session.execute(text("SELECT COUNT(*) FROM messages"))

        assert result.scalar_one() == 0
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_repeated_database_start_keeps_the_existing_runtime() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()

    try:
        async with database.transaction() as session:
            await session.execute(text("CREATE TABLE messages (body TEXT NOT NULL)"))

        await database.start()

        async with database.transaction() as session:
            await session.execute(text("SELECT body FROM messages"))
    finally:
        await database.stop()


def test_database_metadata_names_constraints_deterministically() -> None:
    table = cast(Table, ExampleRecord.__table__)
    primary_key = table.primary_key
    unique_name = next(
        constraint for constraint in table.constraints if isinstance(constraint, UniqueConstraint)
    )

    assert primary_key.name == "pk_example_records"
    assert unique_name.name == "uq_example_records_name"
