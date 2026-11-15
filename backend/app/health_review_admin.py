"""Publish reviewed mission rules from a trusted operator shell."""

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import make_engine
from .health_review import active_policy
from .health_review_rules import ReviewPolicy
from .models import HealthReviewPolicy
from .schemas import Code
from .workspace import public_workspace_enabled


def change_policy(session: Session, mission: str, actor: str, policy: ReviewPolicy | None):
    session.execute(select(func.pg_advisory_xact_lock(func.hashtext("acha-health-review:" + mission))))
    active = active_policy(session, mission, lock=True)
    if policy is not None and session.get(HealthReviewPolicy, (mission, policy.version)) is not None:
        raise ValueError("This policy version is already recorded. Publish a distinct version for a change.")
    now = datetime.now(UTC)
    if active is not None:
        active.retired_at, active.retired_by = now, actor
        session.flush()
    if policy is not None:
        session.add(HealthReviewPolicy(mission_code=mission, version=policy.version,
                                       configuration=policy.model_dump(mode="json"), published_by=actor, published_at=now))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("publish", "retire"))
    parser.add_argument("mission")
    parser.add_argument("--actor", required=True, help="Operator recording the documented approval")
    parser.add_argument("--data", type=Path, help="Approved policy JSON, or use stdin")
    args = parser.parse_args()
    if public_workspace_enabled():
        parser.error("Health-review policy publication requires the restricted workspace.")
    if args.command == "retire" and args.data:
        parser.error("Policy retirement does not take a data file.")
    try:
        code = TypeAdapter(Code)
        mission, actor = code.validate_python(args.mission), code.validate_python(args.actor)
        policy = None
        if args.command == "publish":
            policy = ReviewPolicy.model_validate_json(args.data.read_bytes() if args.data else sys.stdin.buffer.read())
        engine = make_engine()
        try:
            with Session(engine) as session, session.begin():
                change_policy(session, mission, actor, policy)
        finally:
            engine.dispose()
    except ValidationError as error:
        for detail in error.errors(include_input=False, include_context=False, include_url=False):
            print(f"{'.'.join(map(str, detail['loc']))}: {detail['msg']}", file=sys.stderr)
        raise SystemExit(2) from None
    except (ValueError, OSError) as error:
        parser.exit(2, f"{error}\n")
    print("Health-review policy saved.")


if __name__ == "__main__":
    main()
