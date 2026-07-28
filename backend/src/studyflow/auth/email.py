"""Application email canonicalization policy."""


def canonicalize_email(email: str) -> str:
    """Trim surrounding whitespace and match the database lowercase policy."""
    canonical_email = email.strip().lower()
    if not canonical_email:
        raise ValueError("Email is required")
    return canonical_email
