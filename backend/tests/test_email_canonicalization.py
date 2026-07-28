import pytest

from studyflow.auth.email import canonicalize_email


def test_email_canonicalization_is_trimmed_and_case_insensitive() -> None:
    assert canonicalize_email("  Student@Example.COM  ") == "student@example.com"


def test_email_canonicalization_rejects_empty_input() -> None:
    with pytest.raises(ValueError, match="Email is required"):
        canonicalize_email("  ")


def test_email_canonicalization_matches_database_lowercase_semantics() -> None:
    assert canonicalize_email("\u13a0@Example.COM") == "\uab70@example.com"
