from __future__ import annotations

import runpy
import sys
from pathlib import Path


LOGIC_ROOT_ARGUMENT = "--logic-root"


def consume_logic_root(arguments: list[str]) -> Path:
    try:
        position = arguments.index(LOGIC_ROOT_ARGUMENT)
    except ValueError as error:
        raise SystemExit("video editor host requires --logic-root") from error
    if position + 1 >= len(arguments):
        raise SystemExit("video editor host requires a value after --logic-root")
    root = Path(arguments[position + 1]).resolve()
    del arguments[position : position + 2]
    if not (root / "video_editor_module" / "__main__.py").is_file():
        raise SystemExit(f"video editor logic is missing from {root}")
    return root


def main() -> None:
    logic_root = consume_logic_root(sys.argv)
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(logic_root))
    runpy.run_module("video_editor_module", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
