from sqlalchemy import MetaData

from studyflow.database.base import Base
from studyflow.settings import Settings

target_metadata: MetaData = Base.metadata


def get_database_url() -> str:
    """Return the validated database URL without storing it in Alembic configuration."""
    return Settings().database_url.get_secret_value()
