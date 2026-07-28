from sqlalchemy import DefaultClause

from studyflow.database import Base


def test_authentication_tables_are_registered_with_application_metadata() -> None:
    assert {
        "student_accounts",
        "authentication_identities",
        "authentication_sessions",
        "authentication_email_tokens",
    }.issubset(Base.metadata.tables)


def test_student_account_persists_identity_and_planning_defaults() -> None:
    table = Base.metadata.tables["student_accounts"]

    assert set(table.columns.keys()) == {
        "id",
        "email",
        "name",
        "password_hash",
        "email_verified_at",
        "timezone",
        "preferred_session_length_minutes",
        "minimum_break_minutes",
        "created_at",
        "updated_at",
    }
    assert table.c.email.unique is True
    assert table.c.password_hash.nullable is True
    assert table.c.email_verified_at.nullable is True
    assert isinstance(table.c.timezone.server_default, DefaultClause)
    assert isinstance(table.c.preferred_session_length_minutes.server_default, DefaultClause)
    assert isinstance(table.c.minimum_break_minutes.server_default, DefaultClause)
    assert str(table.c.timezone.server_default.arg) == "UTC"
    assert str(table.c.preferred_session_length_minutes.server_default.arg) == "60"
    assert str(table.c.minimum_break_minutes.server_default.arg) == "10"

    constraints = {constraint.name for constraint in table.constraints}
    assert {
        "ck_student_accounts_email_canonical",
        "ck_student_accounts_preferred_session_length",
        "ck_student_accounts_minimum_break",
    }.issubset(constraints)


def test_linked_identity_is_owned_and_unique_per_provider() -> None:
    table = Base.metadata.tables["authentication_identities"]

    assert set(table.columns.keys()) == {
        "id",
        "account_id",
        "provider",
        "subject",
        "email",
        "created_at",
    }
    account_foreign_key = next(iter(table.c.account_id.foreign_keys))
    assert account_foreign_key.target_fullname == "student_accounts.id"
    assert account_foreign_key.ondelete == "CASCADE"

    constraints = {constraint.name for constraint in table.constraints}
    assert {
        "ck_authentication_identities_supported_provider",
        "uq_authentication_identities_provider_subject",
        "uq_authentication_identities_account_provider",
    }.issubset(constraints)


def test_session_stores_only_hashes_and_both_expiry_boundaries() -> None:
    table = Base.metadata.tables["authentication_sessions"]

    assert set(table.columns.keys()) == {
        "id",
        "account_id",
        "token_hash",
        "csrf_token_hash",
        "created_at",
        "idle_expires_at",
        "absolute_expires_at",
        "revoked_at",
    }
    assert "token" not in table.columns
    assert "csrf_token" not in table.columns
    assert table.c.token_hash.unique is True
    assert table.c.revoked_at.nullable is True

    account_foreign_key = next(iter(table.c.account_id.foreign_keys))
    assert account_foreign_key.ondelete == "CASCADE"
    constraints = {constraint.name for constraint in table.constraints}
    assert {
        "ck_authentication_sessions_token_hash_length",
        "ck_authentication_sessions_csrf_token_hash_length",
        "ck_authentication_sessions_expiry_order",
    }.issubset(constraints)


def test_email_action_token_is_hashed_expiring_and_single_use() -> None:
    table = Base.metadata.tables["authentication_email_tokens"]

    assert set(table.columns.keys()) == {
        "id",
        "account_id",
        "purpose",
        "token_hash",
        "created_at",
        "expires_at",
        "consumed_at",
    }
    assert table.c.token_hash.unique is True
    assert table.c.consumed_at.nullable is True
    account_foreign_key = next(iter(table.c.account_id.foreign_keys))
    assert account_foreign_key.ondelete == "CASCADE"

    constraints = {constraint.name for constraint in table.constraints}
    assert {
        "ck_authentication_email_tokens_supported_purpose",
        "ck_authentication_email_tokens_token_hash_length",
        "ck_authentication_email_tokens_expiry_order",
    }.issubset(constraints)
