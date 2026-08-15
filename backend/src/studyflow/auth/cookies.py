"""Centralized browser-cookie policy for authentication."""

from dataclasses import dataclass

from starlette.responses import Response

from studyflow.settings import Environment


@dataclass(frozen=True, slots=True)
class CookiePolicy:
    environment: Environment
    secure: bool

    def __post_init__(self) -> None:
        if self.environment is Environment.PRODUCTION and not self.secure:
            raise ValueError("Production cookies must be secure")

    @classmethod
    def for_environment(cls, environment: Environment) -> "CookiePolicy":
        return cls(
            environment=environment,
            secure=environment is Environment.PRODUCTION,
        )

    @property
    def session_name(self) -> str:
        return self._name("studyflow_session")

    @property
    def csrf_name(self) -> str:
        return self._name("studyflow_csrf")

    @property
    def oidc_state_name(self) -> str:
        return self._name("studyflow_oidc_state")

    def set_authentication(
        self,
        response: Response,
        session_token: str,
        csrf_token: str,
    ) -> None:
        response.set_cookie(
            key=self.session_name,
            value=session_token,
            max_age=7 * 24 * 60 * 60,
            path="/",
            secure=self.secure,
            httponly=True,
            samesite="strict",
        )
        response.set_cookie(
            key=self.csrf_name,
            value=csrf_token,
            max_age=7 * 24 * 60 * 60,
            path="/",
            secure=self.secure,
            httponly=False,
            samesite="strict",
        )

    def clear_authentication(self, response: Response) -> None:
        response.delete_cookie(
            self.session_name,
            path="/",
            secure=self.secure,
            httponly=True,
            samesite="strict",
        )
        response.delete_cookie(
            self.csrf_name,
            path="/",
            secure=self.secure,
            httponly=False,
            samesite="strict",
        )

    def set_oidc_state(self, response: Response, state: str) -> None:
        response.set_cookie(
            key=self.oidc_state_name,
            value=state,
            max_age=10 * 60,
            path="/",
            secure=self.secure,
            httponly=True,
            samesite="lax",
        )

    def clear_oidc_state(self, response: Response) -> None:
        response.delete_cookie(
            self.oidc_state_name,
            path="/",
            secure=self.secure,
            httponly=True,
            samesite="lax",
        )

    def _name(self, base_name: str) -> str:
        return f"__Host-{base_name}" if self.environment is Environment.PRODUCTION else base_name
