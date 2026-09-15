import hashlib
import json
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from studyflow.auth.oidc import (
    GoogleOIDCProvider,
    InvalidOIDCResponseError,
    OIDCProviderUnavailableError,
)


def signed_google_token() -> tuple[str, dict[str, object], str]:
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
            "email": "student@example.com",
            "email_verified": True,
            "nonce": nonce,
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        key,
        algorithm="RS256",
        headers={"kid": "key-1"},
    )
    return token, public_jwk, nonce


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


@pytest.mark.anyio
@pytest.mark.parametrize("endpoint", ["token", "jwks"])
@pytest.mark.parametrize("failure", ["timeout", "connection", "rate_limit", "server_error"])
async def test_google_provider_reports_temporary_transport_failures(
    endpoint: str, failure: str
) -> None:
    token, public_jwk, nonce = signed_google_token()

    async def handler(request: httpx.Request) -> httpx.Response:
        request_endpoint = "token" if request.url.path.endswith("/token") else "jwks"
        if request_endpoint == endpoint:
            if failure == "timeout":
                raise httpx.ReadTimeout("Google timed out", request=request)
            if failure == "connection":
                raise httpx.ConnectError("Google connection failed", request=request)
            return httpx.Response(429 if failure == "rate_limit" else 503)
        if request_endpoint == "token":
            return httpx.Response(200, json={"id_token": token})
        return httpx.Response(200, json={"keys": [public_jwk]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(OIDCProviderUnavailableError) as raised:
            await provider.exchange("code", hashlib.sha256(nonce.encode()).hexdigest())

    assert raised.value.retry_same_callback is (endpoint == "token" and failure == "connection")


@pytest.mark.anyio
async def test_google_provider_keeps_invalid_authorization_codes_as_user_errors() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(InvalidOIDCResponseError):
            await provider.exchange("invalid-code", "nonce-hash")


@pytest.mark.anyio
async def test_google_provider_validated_claims_edge_cases() -> None:
    async with httpx.AsyncClient() as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        nonce = "valid-nonce"
        nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()

        base_claims = {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "sub": "valid-subject",
            "email": "student@example.com",
            "email_verified": True,
            "nonce": nonce,
            "name": "Student Name",
        }

        # 1. Invalid issuer
        with pytest.raises(InvalidOIDCResponseError):
            provider._validated_claims({**base_claims, "iss": "https://attacker.com"}, nonce_hash)

        # 2. Invalid subject: empty, too long, or non-string
        with pytest.raises(InvalidOIDCResponseError):
            provider._validated_claims({**base_claims, "sub": ""}, nonce_hash)
        with pytest.raises(InvalidOIDCResponseError):
            provider._validated_claims({**base_claims, "sub": "x" * 256}, nonce_hash)
        with pytest.raises(InvalidOIDCResponseError):
            provider._validated_claims({**base_claims, "sub": 123}, nonce_hash)

        # 3. Nonce mismatch or non-string
        with pytest.raises(InvalidOIDCResponseError):
            provider._validated_claims({**base_claims, "nonce": "wrong-nonce"}, nonce_hash)
        with pytest.raises(InvalidOIDCResponseError):
            provider._validated_claims({**base_claims, "nonce": 12345}, nonce_hash)

        # 4. Invalid email
        with pytest.raises(InvalidOIDCResponseError):
            provider._validated_claims({**base_claims, "email": "not-an-email"}, nonce_hash)

        # 5. Missing / non-string name -> fallback to email user
        claims_no_name = provider._validated_claims({**base_claims, "name": None}, nonce_hash)
        assert claims_no_name.name == "student"

        # 6. Multiple audiences with matching azp -> succeeds
        claims_multi_aud = provider._validated_claims(
            {**base_claims, "aud": ["client-id", "other-aud"], "azp": "client-id"},
            nonce_hash,
        )
        assert claims_multi_aud.subject == "valid-subject"


@pytest.mark.anyio
async def test_google_provider_decode_id_token_and_exchange_edge_cases() -> None:
    token, _, nonce = signed_google_token()
    nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()

    # 1. Token response with non-string id_token
    async def handler_non_string_token(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id_token": 12345})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler_non_string_token)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(InvalidOIDCResponseError):
            await provider.exchange("code", nonce_hash)

    # 2. Token with non-RS256 algorithm
    bad_alg_token = jwt.encode(
        {"sub": "123"},
        "x" * 32,
        algorithm="HS256",
        headers={"kid": "key-1"},
    )

    async def handler_bad_alg(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id_token": bad_alg_token})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler_bad_alg)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(InvalidOIDCResponseError):
            await provider.exchange("code", nonce_hash)

    # 3. JWKS returns keys not as a list
    async def handler_bad_jwks(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"id_token": token})
        return httpx.Response(200, json={"keys": "not-a-list"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler_bad_jwks)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(InvalidOIDCResponseError):
            await provider.exchange("code", nonce_hash)

    # 4. JWKS returns keys with no matching kid
    async def handler_missing_kid(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"id_token": token})
        return httpx.Response(200, json={"keys": [{"kid": "different-kid"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler_missing_kid)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(InvalidOIDCResponseError):
            await provider.exchange("code", nonce_hash)

    # 5. Token signed by different RSA key -> raises InvalidOIDCResponseError via PyJWTError
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_jwk = json.loads(RSAAlgorithm.to_jwk(other_key.public_key()))
    other_jwk["kid"] = "key-1"

    async def handler_wrong_key(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"id_token": token})
        return httpx.Response(200, json={"keys": [other_jwk]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler_wrong_key)) as client:
        provider = GoogleOIDCProvider(client, "client-id", "client-secret", "https://app/callback")
        with pytest.raises(InvalidOIDCResponseError):
            await provider.exchange("code", nonce_hash)
