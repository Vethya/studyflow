import hashlib
import json
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from studyflow.auth.oidc import GoogleOIDCProvider, InvalidOIDCResponseError


@pytest.mark.anyio
async def test_google_provider_verifies_signature_claims_and_nonce() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    public_jwk["kid"] = "key-1"
    now = datetime.now(UTC)
    nonce = "nonce-secret"
    token = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "sub": "subject",
            "email": "Student@Example.com",
            "email_verified": True,
            "name": "Student",
            "nonce": nonce,
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        key,
        algorithm="RS256",
        headers={"kid": "key-1"},
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"id_token": token, "access_token": "discarded"})
        return httpx.Response(200, json={"keys": [public_jwk]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        claims = await provider.exchange(
            "authorization-code", hashlib.sha256(nonce.encode()).hexdigest()
        )

    assert claims.subject == "subject"
    assert claims.email == "student@example.com"


@pytest.mark.anyio
async def test_google_provider_rejects_unverified_email() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    public_jwk["kid"] = "key-1"
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "sub": "subject",
            "email": "student@example.com",
            "email_verified": False,
            "nonce": "nonce",
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        key,
        algorithm="RS256",
        headers={"kid": "key-1"},
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"id_token": token})
        return httpx.Response(200, json={"keys": [public_jwk]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(InvalidOIDCResponseError):
            await provider.exchange("code", hashlib.sha256(b"nonce").hexdigest())


@pytest.mark.anyio
async def test_google_provider_requires_matching_authorized_party_for_multiple_audiences() -> None:
    claims = {
        "iss": "https://accounts.google.com",
        "aud": ["client-id", "other-client"],
        "sub": "subject",
        "email": "student@example.com",
        "email_verified": True,
        "nonce": "nonce",
    }

    async with httpx.AsyncClient() as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(InvalidOIDCResponseError):
            provider._validated_claims(claims, hashlib.sha256(b"nonce").hexdigest())
