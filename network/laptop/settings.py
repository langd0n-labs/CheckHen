"""Read local settings for setup tools or the container environment."""
import os
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def first_ip_json(output: str, description: str) -> dict:
    entries = json.loads(output)
    if not entries:
        raise RuntimeError(f"No {description} returned by ip -j")
    return entries[0]


def ip_json_addresses(output: str) -> list[dict]:
    return [address for interface in json.loads(output)
            for address in interface.get("addr_info", [])]


def read_env(path: Path | None = None) -> dict[str, str]:
    if path is None and not (ROOT / ".env").exists():
        return dict(os.environ)
    path = path or ROOT / ".env"
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.isidentifier():
            raise ValueError(f"Invalid environment line in {path}")
        values[key] = value.strip().strip('"').strip("'")
    return values
