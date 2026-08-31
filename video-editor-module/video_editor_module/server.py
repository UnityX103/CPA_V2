from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import shutil
import tempfile
import threading
import uuid
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .pipeline import ProcessSettings, probe_video, process_video


MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


@dataclass
class Job:
    id: str
    input_path: Path
    output_path: Path
    preview_path: Path
    status: str = "queued"
    percent: int = 0
    message: str = "等待处理"
    error: str = ""
    lock: threading.Lock = field(default_factory=threading.Lock)

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            return {
                "id": self.id,
                "status": self.status,
                "percent": self.percent,
                "message": self.message,
                "error": self.error,
                "ready": self.status == "complete" and self.output_path.is_file(),
            }


class ModuleContext:
    def __init__(self, token: str):
        self.token = token
        self.root = Path(tempfile.mkdtemp(prefix="cpa-video-editor-module-"))
        self.uploads = self.root / "uploads"
        self.outputs = self.root / "outputs"
        self.uploads.mkdir()
        self.outputs.mkdir()
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


def static_root() -> Path:
    frozen_root = getattr(__import__("sys"), "_MEIPASS", None)
    if frozen_root:
        candidate = Path(frozen_root) / "static"
        if candidate.is_dir():
            return candidate
    return Path(__file__).resolve().parent / "static"


def handler_for(context: ModuleContext):
    class ModuleHandler(BaseHTTPRequestHandler):
        server_version = "CPAVideoEditor/1"

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/") and not self._authorized(parsed):
                self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            if parsed.path == "/api/health":
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if parsed.path == "/api/probe":
                upload_id = first_query(parsed, "id")
                upload_path = upload_for_id(context, upload_id)
                if upload_path is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "upload not found"})
                    return
                try:
                    probe = probe_video(upload_path)
                    self._json(HTTPStatus.OK, {
                        "width": probe.width,
                        "height": probe.height,
                        "durationSeconds": probe.duration_seconds,
                        "frameRate": probe.frame_rate,
                    })
                except Exception as error:  # noqa: BLE001
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if parsed.path == "/api/job":
                job_id = first_query(parsed, "id")
                with context.lock:
                    job = context.jobs.get(job_id)
                if job is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "job not found"})
                else:
                    self._json(HTTPStatus.OK, job.snapshot())
                return
            if parsed.path == "/api/output":
                job_id = first_query(parsed, "id")
                with context.lock:
                    job = context.jobs.get(job_id)
                if job is None or job.status != "complete" or not job.output_path.is_file():
                    self._json(HTTPStatus.NOT_FOUND, {"error": "output not ready"})
                    return
                self._file(job.output_path, "video/webm", f"pet-transparent-{job.id}.webm")
                return
            if parsed.path == "/api/preview":
                job_id = first_query(parsed, "id")
                with context.lock:
                    job = context.jobs.get(job_id)
                if job is None or job.status != "complete":
                    self._json(HTTPStatus.NOT_FOUND, {"error": "preview not ready"})
                    return
                if job.preview_path.is_file():
                    self._file(job.preview_path, "video/quicktime")
                elif job.output_path.is_file():
                    self._file(job.output_path, "video/webm")
                else:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "preview not ready"})
                return
            self._static(parsed.path)

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if not self._authorized(parsed):
                self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            if parsed.path == "/api/upload":
                self._upload(parsed)
                return
            if parsed.path == "/api/process":
                self._start_job()
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

        def _upload(self, parsed) -> None:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if length <= 0 or length > MAX_UPLOAD_BYTES:
                self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid upload size"})
                return
            original = first_query(parsed, "filename") or "source.mp4"
            extension = Path(original).suffix.lower()
            if extension not in {".mp4", ".mov", ".webm", ".m4v", ".ogg", ".ogv"}:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "unsupported video extension"})
                return
            upload_id = uuid.uuid4().hex
            target = context.uploads / f"{upload_id}{extension}"
            remaining = length
            with target.open("wb") as output:
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        target.unlink(missing_ok=True)
                        self._json(HTTPStatus.BAD_REQUEST, {"error": "upload interrupted"})
                        return
                    output.write(chunk)
                    remaining -= len(chunk)
            self._json(HTTPStatus.OK, {"id": upload_id, "filename": Path(original).name})

        def _start_job(self) -> None:
            try:
                payload = self._json_body(64 * 1024)
                upload_id = str(payload["uploadId"])
                source = upload_for_id(context, upload_id)
                if source is None:
                    raise ValueError("uploaded video not found")
                start = float(payload.get("startSeconds", 0))
                end = float(payload.get("endSeconds", 0))
                width = int(payload.get("outputWidth", 0))
                height = int(payload.get("outputHeight", 0))
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            job_id = uuid.uuid4().hex
            output_path = context.outputs / f"{job_id}.webm"
            job = Job(job_id, source, output_path, output_path.with_suffix(".preview.mov"))
            with context.lock:
                busy = any(
                    existing.snapshot()["status"] in {"queued", "processing"}
                    for existing in context.jobs.values()
                )
                if not busy:
                    context.jobs[job_id] = job
            if busy:
                self._json(
                    HTTPStatus.CONFLICT,
                    {"error": "another video job is already running"},
                )
                return
            settings = ProcessSettings(source, job.output_path, start, end, width, height)
            threading.Thread(target=run_job, args=(job, settings), daemon=True).start()
            self._json(HTTPStatus.ACCEPTED, {"id": job_id})

        def _json_body(self, maximum: int) -> dict:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > maximum:
                raise ValueError("invalid JSON body size")
            return json.loads(self.rfile.read(length))

        def _authorized(self, parsed) -> bool:
            query_token = first_query(parsed, "token")
            header_token = self.headers.get("X-CPA-Module-Token")
            return query_token == context.token or header_token == context.token

        def _static(self, path: str) -> None:
            relative = "index.html" if path in {"", "/"} else path.lstrip("/")
            candidate = (static_root() / relative).resolve()
            root = static_root().resolve()
            if root not in candidate.parents and candidate != root:
                self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            if not candidate.is_file():
                self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._file(candidate, mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")

        def _file(self, path: Path, content_type: str, download_name: str | None = None) -> None:
            size = path.stat().st_size
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            if download_name:
                self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.end_headers()
            with path.open("rb") as source:
                shutil.copyfileobj(source, self.wfile, length=1024 * 1024)

        def _json(self, status: HTTPStatus, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format_string: str, *args) -> None:
            if os.environ.get("CPA_VIDEO_EDITOR_LOG"):
                super().log_message(format_string, *args)

    return ModuleHandler


def first_query(parsed, key: str) -> str:
    values = parse_qs(parsed.query).get(key, [])
    return values[0] if values else ""


def upload_for_id(context: ModuleContext, upload_id: str) -> Path | None:
    if not ID_PATTERN.fullmatch(upload_id):
        return None
    matches = list(context.uploads.glob(f"{upload_id}.*"))
    return matches[0] if len(matches) == 1 and matches[0].is_file() else None


def run_job(job: Job, settings: ProcessSettings) -> None:
    with job.lock:
        job.status = "processing"
        job.message = "正在准备视频"

    def update(percent: int, message: str) -> None:
        with job.lock:
            job.percent = max(0, min(100, percent))
            job.message = message

    try:
        process_video(settings, update)
        with job.lock:
            job.status = "complete"
            job.percent = 100
            job.message = "透明视频已生成"
    except Exception as error:  # noqa: BLE001
        with job.lock:
            job.status = "error"
            job.error = str(error)
            job.message = "视频处理失败"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    if args.host != "127.0.0.1" or not (1 <= args.port <= 65535) or len(args.token) < 32:
        raise SystemExit("invalid local server configuration")
    context = ModuleContext(args.token)
    server = ThreadingHTTPServer((args.host, args.port), handler_for(context))
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
        context.close()
