import pytest

from studyflow.app import create_app
from studyflow.settings import Environment, Settings


class TrackingDatabase:
    def __init__(self) -> None:
        self.events: list[str] = []

    async def start(self) -> None:
        self.events.append("started")

    async def stop(self) -> None:
        self.events.append("stopped")

    async def ping(self) -> None:
        pass


@pytest.mark.anyio
async def test_app_lifespan_owns_the_database_runtime() -> None:
    database = TrackingDatabase()
    app = create_app(
        Settings(environment=Environment.TEST),
        database=database,
    )

    assert database.events == []

    async with app.router.lifespan_context(app):
        assert database.events == ["started"]

    assert database.events == ["started", "stopped"]
