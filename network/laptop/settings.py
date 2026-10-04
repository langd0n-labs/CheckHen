"""Read the ignored project environment file without executing shell code."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_env(path: Path = ROOT / ".env") -> dict[str, str]:
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
