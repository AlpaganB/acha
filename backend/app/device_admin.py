"""Provision device channels from the restricted deployment shell."""

import argparse
import sys
from pathlib import Path
from secrets import compare_digest

from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import make_engine
from .models import DeviceChannel, MissionClock, ObservationAudit
from .observation_access import CredentialHash
from .observation_registry import PARAMETERS
from .schemas import ApiModel, Code, Timestamp
from .telemetry import ChannelSettings
from .workspace import public_workspace_enabled


class ClockSettings(ApiModel):
    epoch: Timestamp


class KeySettings(ApiModel):
    credential_sha256: CredentialHash


class DeviceRegistration(KeySettings):
    configuration: ChannelSettings


COMMANDS = {
    "set-clock": ClockSettings,
    "register": DeviceRegistration,
    "rotate-key": KeySettings,
    "revoke-key": None,
}


def configure(session: Session, command: str, mission: str, code: str | None,
              actor: str, payload: ApiModel | None) -> None:
    clock = session.get(MissionClock, mission)
    if command == "set-clock":
        if clock is None:
            session.add(MissionClock(code=mission, epoch=payload.epoch))
        elif clock.epoch != payload.epoch:
            raise ValueError("A mission clock epoch is immutable.")
        else:
            return
        session.add(ObservationAudit(actor=actor, action="set_clock", mission_code=mission, scope="environment"))
        return

    if clock is None:
        raise ValueError("Set the mission clock before registering a device.")
    channel = session.get(DeviceChannel, (mission, code), with_for_update=True)
    if command == "register":
        if channel is not None:
            raise ValueError("Channel already exists. Use a new code for new device metadata.")
        settings = payload.configuration
        channel = DeviceChannel(mission_code=mission, code=code, crew_code=settings.crew_code,
                                sha256=payload.credential_sha256,
                                configuration=settings.model_dump(mode="json", exclude={"crew_code"}))
        session.add(channel)
    elif channel is None:
        raise ValueError("Device channel is unknown.")
    elif command == "rotate-key":
        if channel.sha256 is not None and compare_digest(channel.sha256, payload.credential_sha256):
            raise ValueError("Rotation requires a different key.")
        channel.sha256 = payload.credential_sha256
    elif command == "revoke-key":
        if channel.sha256 is None:
            return
        channel.sha256 = None
    else:
        raise ValueError("Unknown device administration command.")
    scope = PARAMETERS[channel.configuration["parameter"]].scope
    session.add(ObservationAudit(actor=actor, action=command.replace("-", "_"), mission_code=mission,
                                 scope=scope, crew_code=channel.crew_code))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("mission")
    parser.add_argument("channel", nargs="?")
    parser.add_argument("--actor", required=True)
    parser.add_argument("--data", type=Path, help="Read the configuration JSON from this file or from stdin")
    args = parser.parse_args()
    if (args.channel is None) != (args.command == "set-clock"):
        parser.error("Provide a channel for register, rotate-key and revoke-key.")
    if args.data is not None and args.command == "revoke-key":
        parser.error("Revoking a key takes no configuration.")
    if public_workspace_enabled():
        parser.error("Device administration requires ACHA_PUBLIC_WORKSPACE=disabled.")
    try:
        code = TypeAdapter(Code)
        mission = code.validate_python(args.mission)
        actor = code.validate_python(args.actor)
        channel = code.validate_python(args.channel) if args.channel else None
        schema = COMMANDS[args.command]
        payload = schema.model_validate_json(args.data.read_bytes() if args.data else sys.stdin.buffer.read()) if schema else None
        engine = make_engine()
        try:
            with Session(engine) as session, session.begin():
                configure(session, args.command, mission, channel, actor, payload)
        finally:
            engine.dispose()
    except ValidationError as error:
        for detail in error.errors(include_input=False, include_context=False, include_url=False):
            print(f"{'.'.join(map(str, detail['loc']))}: {detail['msg']}", file=sys.stderr)
        raise SystemExit(2) from None
    except IntegrityError:
        parser.exit(2, "A mission, channel or device credential already uses these settings.\n")
    except (ValueError, OSError) as error:
        parser.exit(2, f"{error}\n")
    print("Device configuration saved.")


if __name__ == "__main__":
    main()
