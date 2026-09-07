#!/usr/bin/env python3
"""Thin loader: the versioned installer is maintained in Agent-Template."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.request import urlopen


def main():
    if sys.argv[1:] not in ([], ["--check"]):
        raise ValueError("Usage: python3 tools/agent-skills.py [--check]")
    project = Path(__file__).resolve().parents[1]
    lock = json.loads((project / ".agents/skills.lock.json").read_text())
    bootstrap = lock["bootstrap"]
    revision, digest = bootstrap["revision"], bootstrap["sha256"]
    if not re.fullmatch(r"[0-9a-f]{40}", revision) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("Bootstrap must have a full commit SHA and SHA-256 digest")
    directory = project / ".agents/cache/bootstrap"
    for path in [project / ".agents", project / ".agents/cache", directory]:
        if path.is_symlink():
            raise ValueError("Bootstrap cache cannot be redirected by a symlink")
    cached = directory / f"{digest}.py"
    if cached.is_symlink():
        raise ValueError("Bootstrap script cannot be a symlink")
    if cached.exists():
        content = cached.read_bytes()
    elif "--check" in sys.argv:
        raise ValueError("Bootstrap is not cached; run python3 tools/agent-skills.py first")
    else:
        url = f"https://raw.githubusercontent.com/howellsryan/Agent-Template/{revision}/scripts/install_skills.py"
        with urlopen(url, timeout=60) as response:
            content = response.read()
    if hashlib.sha256(content).hexdigest() != digest:
        raise ValueError("Installer checksum mismatch; no installer code was executed")
    directory.mkdir(parents=True, exist_ok=True)
    if not cached.exists():
        cached.write_bytes(content)
    return subprocess.call([sys.executable, "-B", str(cached), "--project", str(project), *sys.argv[1:]])


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError) as error:
        print(f"Agent skills: {error}", file=sys.stderr)
        sys.exit(1)
