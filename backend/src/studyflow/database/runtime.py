from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Protocol

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


class DatabaseLifecycle(Protocol):
    async def start(self) -> None: ...

    async def stop(self) -> None: ...


class DatabaseReadiness(Protocol):
    async def ping(self) -> None: ...


class DatabaseRuntime(DatabaseLifecycle, DatabaseReadiness, Protocol):
    pass


class Database:
    def __init__(self, url: str) -> None:
        self._url = url
        self._engine: AsyncEngine | None = None
        self._session_factory: async_sessionmaker[AsyncSession] | None = None

    async def start(self) -> None:
        if self._engine is not None:
            return

        engine = create_async_engine(self._url, pool_pre_ping=True)
        self._engine = engine
        self._session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def stop(self) -> None:
        engine = self._engine
        self._engine = None
        self._session_factory = None
        if engine is not None:
            await engine.dispose()

    async def ping(self) -> None:
        async with self.transaction() as session:
            await session.execute(text("SELECT 1"))

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[AsyncSession]:
        if self._session_factory is None:
            raise RuntimeError("Database has not been started")

        async with self._session_factory.begin() as session:
            yield session
