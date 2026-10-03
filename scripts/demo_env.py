import os
from pathlib import Path


def load_demo_env():
    root = Path(__file__).resolve().parent.parent
    values = {}
    for path in [root / ".env.example", root / ".env"]:
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    for key, value in values.items():
        os.environ.setdefault(key, value)
