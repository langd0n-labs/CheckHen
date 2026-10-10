#!/usr/bin/env python3
"""Set the local instructor allowlist without putting identities in the repository."""
import os
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"
USERNAME = re.compile(r"^[a-zA-Z0-9._+-]+$")


def main() -> None:
    if not ENV.exists():
        raise SystemExit("Configure the ignored application environment first")
    names = [name.strip() for name in input("BU instructor usernames, comma separated: ").split(",")]
    if not names or any(not USERNAME.fullmatch(name) for name in names):
        raise SystemExit("Enter one or more usernames without @bu.edu")
    source = ENV.read_text()
    lines = [f"ADMIN_EMAILS={','.join(names)}" if line.startswith("ADMIN_EMAILS=") else line
             for line in source.splitlines()]
    temporary = ENV.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write("\n".join(lines) + "\n")
    temporary.replace(ENV)
    print("Updated instructor allowlist in ignored .env")


if __name__ == "__main__":
    main()
