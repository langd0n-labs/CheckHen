#!/usr/bin/env python3
"""Initialize local configuration and start the application with Compose."""
import os
from pathlib import Path
import secrets
import subprocess

root = Path(__file__).resolve().parent.parent
os.chdir(root)
env = root / ".env"
if not env.exists():
    text = (root / ".env.example").read_text()
    text = text.replace("POSTGRES_PASSWORD=\n", f"POSTGRES_PASSWORD={secrets.token_hex(24)}\n")
    text = text.replace("AUTH_SECRET=\n", f"AUTH_SECRET={secrets.token_hex(32)}\n")
    text = text.replace("PORTAL_CONTROL_SECRET=\n", f"PORTAL_CONTROL_SECRET={secrets.token_hex(32)}\n")
    fd = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as file:
        file.write(text)
    print("Created .env. Configure Google OAuth credentials there before signing in.", flush=True)
subprocess.run(["podman", "compose", "up", "--build", "-d"], check=True)
