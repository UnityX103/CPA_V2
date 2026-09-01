#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

import build_runtime


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--python", type=Path, default=Path(sys.executable))
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parents[1]
    policy = json.loads((project_root / "source-policy.json").read_text(encoding="utf-8"))
    temporary = None
    if args.cache_dir is None:
        temporary = tempfile.TemporaryDirectory(prefix="cpa-video-model-cache-")
        cache = Path(temporary.name)
    else:
        cache = args.cache_dir.resolve()
        cache.mkdir(parents=True, exist_ok=True)
    try:
        if args.output.exists():
            shutil.rmtree(args.output)
        build_runtime.prepare_models(
            project_root,
            policy,
            cache,
            args.output,
            args.python.resolve(),
        )
        print(args.output)
    finally:
        if temporary is not None:
            temporary.cleanup()


if __name__ == "__main__":
    main()
