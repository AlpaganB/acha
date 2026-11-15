import hashlib
import json
import os
import secrets
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import Field, StringConstraints, TypeAdapter

from .schemas import ApiModel, Code

Role = Literal["operations", "medical"]
CredentialHash = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
bearer = HTTPBearer(auto_error=False)


class Credential(ApiModel):
    role: Role
    sha256: CredentialHash
    missions: list[Code] = Field(min_length=1)
    crew: dict[Code, list[Code]] | None = None


class Access(ApiModel):
    actor: Code
    role: Role
    missions: list[Code]
    crew: dict[Code, list[Code]] | None = Field(default=None, exclude=True)


def load_observation_access() -> dict[str, Credential]:
    # Parse at startup so a typo cannot silently grant access or leak the credential configuration.
    try:
        config = TypeAdapter(dict[Code, Credential]).validate_python(
            json.loads(os.getenv("ACHA_OBSERVATION_ACCESS", "{}"))
        )
        if len({entry.sha256 for entry in config.values()}) != len(config):
            raise ValueError("Duplicate credential hashes")
        for entry in config.values():
            if entry.crew is not None and (entry.role != "medical" or not set(entry.crew).issubset(entry.missions)):
                raise ValueError("Invalid crew scope")
        return config
    except ValueError:
        raise RuntimeError("Invalid ACHA_OBSERVATION_ACCESS configuration.") from None


def require_access(
    request: Request, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Access:
    if credentials is not None and 32 <= len(credentials.credentials) <= 256:
        digest = hashlib.sha256(credentials.credentials.encode()).hexdigest()
        for actor, entry in request.app.state.observation_access.items():
            if secrets.compare_digest(entry.sha256, digest):
                return Access(actor=actor, role=entry.role, missions=entry.missions, crew=entry.crew)
    raise HTTPException(401, "A valid mission access key is required.", headers={"WWW-Authenticate": "Bearer"})


ObservationAccess = Annotated[Access, Depends(require_access)]
