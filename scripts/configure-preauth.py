#!/usr/bin/env python3
"""Enable one sign-in discovery run or lock down its observed hostnames."""
import os
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"
DOMAIN = re.compile(r"^[a-z0-9.-]+$")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"discover", "lock"}:
        raise SystemExit("Usage: python3 scripts/configure-preauth.py discover|lock [domain ...]")
    if sys.argv[1] == "lock" and len(sys.argv) < 3:
        raise SystemExit("Pass the sign-in hostnames after lock")
    names = [name.lower() for name in sys.argv[2:]]
    if any(not DOMAIN.fullmatch(name) for name in names):
        raise SystemExit("Invalid sign-in hostname")
    replacements = {"PREAUTH_DISCOVERY": "1" if sys.argv[1] == "discover" else "0"}
    if names:
        replacements["PREAUTH_DOMAINS"] = ",".join(dict.fromkeys(names))
    lines = []
    for line in ENV.read_text().splitlines():
        key = line.partition("=")[0]
        lines.append(f"{key}={replacements[key]}" if key in replacements else line)
    temporary = ENV.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write("\n".join(lines) + "\n")
    temporary.replace(ENV)
    print("Updated ignored pre-sign-in network configuration")


if __name__ == "__main__":
    main()
