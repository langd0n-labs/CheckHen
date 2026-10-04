#!/usr/bin/env python3
"""Issue a DNS-01 certificate without exposing the Cloudflare token."""
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / ".build-cache/letsencrypt"


def main() -> None:
    token = os.environ.get("BUZZ_CLOUDFLARE_DNS_TOKEN")
    if not token:
        raise SystemExit("Run through agent-credential with fishjump project access")
    settings = dict(line.split("=", 1) for line in (ROOT / ".env").read_text().splitlines()
                    if line and not line.startswith("#") and "=" in line)
    host = settings.get("AP_HOSTNAME") or "checkhen.rfkill.dev"
    certbot = ROOT / ".build-cache/certbot/bin/certbot"
    if not certbot.is_file():
        raise SystemExit("Install certbot and certbot-dns-cloudflare in .build-cache/certbot first")
    BASE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cloudflare-", dir=BASE) as directory:
        credentials = Path(directory) / "credentials.ini"
        credentials.write_text(f"dns_cloudflare_api_token = {token}\n")
        credentials.chmod(0o600)
        subprocess.run([
            str(certbot), "certonly", "--dns-cloudflare",
            "--dns-cloudflare-credentials", str(credentials),
            "--dns-cloudflare-propagation-seconds", "30",
            "--config-dir", str(BASE / "config"),
            "--work-dir", str(BASE / "work"),
            "--logs-dir", str(BASE / "logs"),
            "--non-interactive", "--agree-tos", "--register-unsafely-without-email",
            "-d", host,
        ], check=True)
    print("Certificate files are in the ignored .build-cache/letsencrypt/config directory")


if __name__ == "__main__":
    main()
