#!/usr/bin/env python3
"""Select the USB AP radio and set a private passphrase in the ignored .env."""
from getpass import getpass
import json
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"


def main() -> None:
    if not ENV.exists():
        raise SystemExit("Run configure-credentials.py through agent-credential first")
    routes = json.loads(subprocess.run(["ip", "-j", "route", "get", "1.1.1.1"],
                                       check=True, capture_output=True, text=True).stdout)
    uplink = routes[0]["dev"]
    radios = []
    for line in subprocess.run(["iw", "dev"], check=True, capture_output=True,
                               text=True).stdout.splitlines():
        line = line.strip()
        if line.startswith("Interface "):
            radios.append(line.split(" ", 1)[1])
    candidates = [radio for radio in radios if radio != uplink]
    if not candidates:
        raise SystemExit("Attach the USB Wi-Fi adapter, then run this command again")
    if len(candidates) == 1:
        ap = candidates[0]
    else:
        print("AP radio candidates: " + ", ".join(candidates))
        ap = input("AP interface: ").strip()
        if ap not in candidates:
            raise SystemExit("Select one of the listed AP interfaces")
    phy_file = Path("/sys/class/net") / ap / "phy80211/name"
    if not phy_file.is_file():
        raise SystemExit("The selected interface has no Wi-Fi radio")
    phy = phy_file.read_text().strip()
    info = subprocess.run(["iw", "phy", phy, "info"], check=True,
                          capture_output=True, text=True).stdout
    modes = info.partition("Supported interface modes:")[2].partition("\n\tBand ")[0]
    if not re.search(r"^\s*\* AP$", modes, re.MULTILINE):
        raise SystemExit("The selected USB radio does not advertise AP mode")
    source = ENV.read_text()
    current = dict(line.split("=", 1) for line in source.splitlines()
                   if line and not line.startswith("#") and "=" in line)
    passphrase = current.get("AP_PASSPHRASE") or getpass("Classroom Wi-Fi passphrase (8-63 characters): ")
    if not 8 <= len(passphrase) <= 63 or "\n" in passphrase:
        raise SystemExit("The Wi-Fi passphrase must be 8-63 characters")
    replacements = {"AP_INTERFACE": ap, "UPLINK_INTERFACE": uplink,
                    "AP_PASSPHRASE": passphrase}
    lines = []
    for line in source.splitlines():
        key = line.partition("=")[0]
        lines.append(f"{key}={replacements[key]}" if key in replacements else line)
    temporary = ENV.with_suffix(".tmp")
    temporary.write_text("\n".join(lines) + "\n")
    temporary.chmod(0o600)
    temporary.replace(ENV)
    print(f"Configured AP interface {ap} and uplink {uplink}; passphrase is in ignored .env")


if __name__ == "__main__":
    main()
