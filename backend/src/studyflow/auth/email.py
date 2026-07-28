"""Application email canonicalization policy."""


def canonicalize_email(email: str) -> str:
    """Trim surrounding whitespace and apply Unicode-aware case folding."""
    canonical_email = email.strip().casefold()
    if not canonical_email:
        raise ValueError("Email is required")
    return canonical_email
