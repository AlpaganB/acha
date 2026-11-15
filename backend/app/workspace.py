import os


def public_workspace_enabled() -> bool:
    value = os.getenv("ACHA_PUBLIC_WORKSPACE", "enabled")
    if value not in {"enabled", "disabled"}:
        raise RuntimeError("ACHA_PUBLIC_WORKSPACE must be enabled or disabled.")
    return value == "enabled"
