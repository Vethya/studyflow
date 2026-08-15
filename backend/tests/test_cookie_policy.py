from pytest import raises
from starlette.responses import Response

from studyflow.auth.cookies import CookiePolicy
from studyflow.settings import Environment


def test_development_cookie_policy_supports_local_http() -> None:
    policy = CookiePolicy.for_environment(Environment.DEVELOPMENT)
    response = Response()

    policy.set_authentication(response, "session-token", "csrf-token")
    policy.set_oidc_state(response, "oidc-state")

    cookies = response.headers.getlist("set-cookie")
    assert any("studyflow_session=session-token" in cookie for cookie in cookies)
    assert any("studyflow_csrf=csrf-token" in cookie for cookie in cookies)
    assert any("studyflow_oidc_state=oidc-state" in cookie for cookie in cookies)
    assert all("Secure" not in cookie for cookie in cookies)
    assert all("__Host-" not in cookie for cookie in cookies)


def test_production_cookie_policy_is_host_prefixed_and_secure() -> None:
    policy = CookiePolicy.for_environment(Environment.PRODUCTION)
    response = Response()

    policy.set_authentication(response, "session-token", "csrf-token")
    policy.set_oidc_state(response, "oidc-state")

    cookies = response.headers.getlist("set-cookie")
    assert any("__Host-studyflow_session=session-token" in cookie for cookie in cookies)
    assert any("__Host-studyflow_csrf=csrf-token" in cookie for cookie in cookies)
    assert any("__Host-studyflow_oidc_state=oidc-state" in cookie for cookie in cookies)
    assert all("Secure" in cookie for cookie in cookies)


def test_production_refuses_an_insecure_cookie_policy() -> None:
    with raises(ValueError, match="Production cookies must be secure"):
        CookiePolicy(environment=Environment.PRODUCTION, secure=False)
