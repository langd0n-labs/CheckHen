#!/usr/bin/env python3
"""Write the application OAuth secrets to its ignored environment file."""
import os
from pathlib import Path
import secrets


ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"


def main() -> None:
    client_id = os.environ.get("CHECKHEN_GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("CHECKHEN_GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise SystemExit("Run through agent-credential with fishjump project access")
    source = ENV.read_text() if ENV.exists() else (ROOT / ".env.example").read_text()
    current = dict(line.split("=", 1) for line in source.splitlines()
                   if line and not line.startswith("#") and "=" in line)
    host = current.get("AP_HOSTNAME") or "checkhen.rfkill.dev"
    address = current.get("AP_ADDRESS") or "172.16.77.1"
    values = {
        "AUTH_GOOGLE_ID": client_id,
        "AUTH_GOOGLE_SECRET": client_secret,
        "NEXTAUTH_URL": f"https://{host}",
        "NEXT_PUBLIC_SOCKET_URL": f"https://{host}",
        "PORTAL_AGENT_URL": f"http://{address}:7878",
        "CERT_FULLCHAIN": str(ROOT / ".build-cache/letsencrypt/config/live" / host / "fullchain.pem"),
        "CERT_PRIVKEY": str(ROOT / ".build-cache/letsencrypt/config/live" / host / "privkey.pem"),
    }
    for key in ("POSTGRES_PASSWORD", "AUTH_SECRET", "PORTAL_CONTROL_SECRET"):
        if not any(line.startswith(f"{key}=") and line.partition("=")[2]
                   for line in source.splitlines()):
            values[key] = secrets.token_hex(32)
    lines = []
    seen = set()
    for line in source.splitlines():
        key = line.partition("=")[0]
        if key in values:
            lines.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            lines.append(line)
    lines.extend(f"{key}={value}" for key, value in values.items() if key not in seen)
    temporary = ENV.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write("\n".join(lines) + "\n")
    temporary.replace(ENV)
    print("Updated ignored .env with the OAuth client and local secrets")


if __name__ == "__main__":
    main()
