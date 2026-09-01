from __future__ import annotations

import json
import math
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable


Progress = Callable[[int, str], None]


@dataclass(frozen=True)
class VideoProbe:
    width: int
    height: int
    duration_seconds: float
    frame_rate: float


@dataclass(frozen=True)
class MattingParameters:
    background_cutoff: float = 0.0
    seed_threshold: float = 0.5
    core_threshold: float = 0.35
    support_radius: int = 30
    feather_sigma: float = 5.0

    @classmethod
    def from_mapping(cls, value) -> "MattingParameters":
        document = {} if value is None else value
        if not isinstance(document, dict):
            raise ValueError("mattingParameters 必须是对象")
        background_cutoff = bounded_float(document, "backgroundCutoff", 0.0, 0.0, 0.5)
        seed_threshold = bounded_float(document, "seedThreshold", 0.5, 0.05, 0.95)
        core_threshold = bounded_float(document, "coreThreshold", 0.35, 0.0, 0.95)
        support_radius = bounded_int(document, "supportRadius", 30, 0, 100)
        feather_sigma = bounded_float(document, "featherSigma", 5.0, 0.0, 20.0)
        return cls(
            background_cutoff=background_cutoff,
            seed_threshold=seed_threshold,
            core_threshold=core_threshold,
            support_radius=support_radius,
            feather_sigma=feather_sigma,
        )


@dataclass(frozen=True)
class SubjectSelection:
    mode: str = "auto"
    x: float = 0.5
    y: float = 0.5
    time_seconds: float = 0.0

    @classmethod
    def from_mapping(cls, value) -> "SubjectSelection":
        document = {} if value is None else value
        if not isinstance(document, dict):
            raise ValueError("subjectSelection 必须是对象")
        mode = str(document.get("mode", "auto"))
        if mode == "auto":
            return cls()
        if mode != "point":
            raise ValueError("主体选择模式无效")
        try:
            x = float(document["x"])
            y = float(document["y"])
            time_seconds = float(document.get("timeSeconds", 0.0))
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("点选主体参数无效") from error
        if not all(math.isfinite(item) for item in (x, y, time_seconds)):
            raise ValueError("点选主体参数无效")
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 and time_seconds >= 0.0):
            raise ValueError("点选主体坐标或时间超出范围")
        return cls(mode="point", x=x, y=y, time_seconds=time_seconds)


@dataclass(frozen=True)
class ProcessSettings:
    input_path: Path
    output_path: Path
    start_seconds: float
    end_seconds: float
    output_width: int
    output_height: int
    subject_selection: SubjectSelection = field(default_factory=SubjectSelection)
    matting_parameters: MattingParameters = field(default_factory=MattingParameters)


def bounded_float(document: dict, key: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(document.get(key, default))
    except (TypeError, ValueError) as error:
        raise ValueError(f"{key} 必须是数字") from error
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"{key} 必须在 {minimum} 到 {maximum} 之间")
    return value


def bounded_int(document: dict, key: str, default: int, minimum: int, maximum: int) -> int:
    raw = document.get(key, default)
    if isinstance(raw, bool):
        raise ValueError(f"{key} 必须是整数")
    try:
        value = int(raw)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{key} 必须是整数") from error
    if value != raw or not minimum <= value <= maximum:
        raise ValueError(f"{key} 必须是 {minimum} 到 {maximum} 之间的整数")
    return value


def normalize_resolution(
    source_width: int,
    source_height: int,
    requested_width: int,
    requested_height: int,
) -> tuple[int, int]:
    if source_width < 2 or source_height < 2:
        raise ValueError("视频分辨率无效")
    width = requested_width if requested_width > 0 else source_width
    height = requested_height if requested_height > 0 else source_height
    if requested_width > 0 and requested_height <= 0:
        height = round(source_height * requested_width / source_width)
    elif requested_height > 0 and requested_width <= 0:
        width = round(source_width * requested_height / source_height)
    width = max(2, min(4096, width))
    height = max(2, min(4096, height))
    width -= width % 2
    height -= height % 2
    return width, height


def fuse_alpha_arrays(alpha, tracked_mask, parameters: MattingParameters | None = None):
    import cv2
    import numpy as np

    parameters = parameters or MattingParameters()
    alpha = np.asarray(alpha, dtype=np.float32)
    tracked = (np.asarray(tracked_mask) >= 0.5).astype(np.uint8)
    if alpha.shape != tracked.shape:
        raise ValueError("alpha 与跟踪蒙版尺寸不一致")
    core = cv2.erode(tracked, np.ones((9, 9), np.uint8), iterations=1).astype(bool)
    support_size = parameters.support_radius * 2 + 1
    outer = cv2.dilate(
        tracked,
        np.ones((support_size, support_size), np.uint8),
        iterations=1,
    ).astype(np.float32)
    if parameters.feather_sigma > 0:
        outer = cv2.GaussianBlur(
            outer,
            (0, 0),
            sigmaX=parameters.feather_sigma,
            sigmaY=parameters.feather_sigma,
        )
    fused = np.clip(alpha, 0.0, 1.0) * np.clip(outer, 0.0, 1.0)
    confident_core = core & (alpha >= parameters.core_threshold)
    fused[confident_core] = np.maximum(fused[confident_core], 0.97)
    if parameters.background_cutoff > 0:
        fused[fused < parameters.background_cutoff] = 0.0
    return np.clip(fused, 0.0, 1.0)


def resolve_point_seed(
    selection: SubjectSelection,
    *,
    start_seconds: float,
    end_seconds: float,
    frame_rate: float,
    frame_count: int,
    width: int,
    height: int,
) -> tuple[int, tuple[float, float]] | None:
    if selection.mode == "auto":
        return None
    if not start_seconds <= selection.time_seconds <= end_seconds:
        raise ValueError("点选主体所在帧不在当前时间范围内")
    frame_index = round((selection.time_seconds - start_seconds) * frame_rate)
    frame_index = max(0, min(frame_count - 1, frame_index))
    return frame_index, (selection.x * (width - 1), selection.y * (height - 1))


def runtime_root() -> Path:
    configured = os.environ.get("CPA_VIDEO_EDITOR_RUNTIME_ROOT")
    if configured:
        return Path(configured).resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2] / "runtime-dev"


def executable(root: Path, name: str) -> Path:
    suffix = ".exe" if os.name == "nt" else ""
    candidate = root / "bin" / f"{name}{suffix}"
    if not candidate.is_file():
        raise RuntimeError(f"视频编辑模块缺少 {name}")
    return candidate


def probe_video(path: Path, root: Path | None = None) -> VideoProbe:
    root = root or runtime_root()
    ffprobe = executable(root, "ffprobe")
    result = subprocess.run(
        [
            str(ffprobe),
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "format=duration:stream=width,height,avg_frame_rate,r_frame_rate",
            "-of", "json",
            str(path),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    document = json.loads(result.stdout)
    stream = document["streams"][0]
    duration = float(document.get("format", {}).get("duration") or 0)
    rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "30/1"
    numerator, denominator = rate.split("/", 1)
    frame_rate = float(numerator) / max(float(denominator), 1.0)
    return VideoProbe(
        width=int(stream["width"]),
        height=int(stream["height"]),
        duration_seconds=duration,
        frame_rate=frame_rate,
    )


def process_video(settings: ProcessSettings, progress: Progress) -> Path:
    root = runtime_root()
    probe = probe_video(settings.input_path, root)
    width, height = normalize_resolution(
        probe.width,
        probe.height,
        settings.output_width,
        settings.output_height,
    )
    start = max(0.0, min(settings.start_seconds, probe.duration_seconds))
    end = settings.end_seconds if settings.end_seconds > 0 else probe.duration_seconds
    end = max(start + 0.1, min(end, probe.duration_seconds))
    work_root = Path(tempfile.mkdtemp(prefix="cpa-video-editor-"))
    try:
        frames = work_root / "frames"
        sam_frames = work_root / "sam-frames"
        biref_masks = work_root / "birefnet"
        sam_masks = work_root / "sam2"
        fused_masks = work_root / "fusion"
        for directory in [frames, sam_frames, biref_masks, sam_masks, fused_masks]:
            directory.mkdir(parents=True, exist_ok=True)

        progress(2, "正在解码并调整分辨率")
        _decode_frames(
            settings.input_path,
            frames,
            sam_frames,
            start,
            end - start,
            width,
            height,
            probe.frame_rate,
            root,
        )
        frame_paths = sorted(frames.glob("*.png"))
        if len(frame_paths) < 2:
            raise RuntimeError("视频片段至少需要两帧")

        progress(8, "正在运行 BiRefNet 毛发抠图")
        alpha_paths = _run_birefnet(frame_paths, biref_masks, root, progress)
        point_seed = resolve_point_seed(
            settings.subject_selection,
            start_seconds=start,
            end_seconds=end,
            frame_rate=probe.frame_rate,
            frame_count=len(frame_paths),
            width=width,
            height=height,
        )
        if point_seed is None:
            seed_index = _choose_seed_frame(
                alpha_paths,
                settings.matting_parameters.seed_threshold,
            )
            seed_point = None
        else:
            seed_index, seed_point = point_seed

        progress(52, "正在使用 SAM 2.1 双向跟踪主体")
        _run_sam2(
            sam_frames,
            alpha_paths[seed_index],
            seed_index,
            sam_masks,
            root,
            progress,
            seed_point=seed_point,
            seed_threshold=settings.matting_parameters.seed_threshold,
        )

        progress(87, "正在融合时序身份与毛发 alpha")
        _fuse_masks(
            alpha_paths,
            sam_masks,
            fused_masks,
            progress,
            settings.matting_parameters,
        )

        progress(94, "正在编码透明 WebM")
        settings.output_path.parent.mkdir(parents=True, exist_ok=True)
        _encode_webm(frames, fused_masks, settings.output_path, probe.frame_rate, root)
        if platform.system() == "Darwin":
            progress(98, "正在生成 macOS 透明预览")
            _encode_macos_preview(
                settings.output_path,
                settings.output_path.with_suffix(".preview.mov"),
                root,
            )
        _write_metadata(
            settings.output_path,
            probe,
            width,
            height,
            start,
            end,
            seed_index,
            len(frame_paths),
            settings.subject_selection,
            settings.matting_parameters,
        )
        progress(100, "透明视频已生成")
        return settings.output_path
    finally:
        shutil.rmtree(work_root, ignore_errors=True)


def _decode_frames(
    source: Path,
    frames: Path,
    sam_frames: Path,
    start: float,
    duration: float,
    width: int,
    height: int,
    frame_rate: float,
    root: Path,
) -> None:
    ffmpeg = executable(root, "ffmpeg")
    common = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{start:.6f}", "-t", f"{duration:.6f}", "-i", str(source),
        "-an", "-vf", f"fps={frame_rate:.8f},scale={width}:{height}:flags=lanczos",
    ]
    subprocess.run(common + [str(frames / "%06d.png")], check=True)
    subprocess.run(
        common + ["-q:v", "2", "-start_number", "0", str(sam_frames / "%05d.jpg")],
        check=True,
    )


def _run_birefnet(frame_paths: list[Path], output_dir: Path, root: Path, progress: Progress) -> list[Path]:
    import numpy as np
    import torch
    from PIL import Image
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation

    use_mps = (
        platform.system() == "Darwin"
        and platform.machine().lower() in {"arm64", "aarch64"}
        and torch.backends.mps.is_available()
    )
    device = torch.device(
        "mps" if use_mps else "cuda" if torch.cuda.is_available() else "cpu"
    )
    dtype = torch.float16 if device.type in {"mps", "cuda"} else torch.float32
    model_dir = root / "models" / "birefnet"
    model = AutoModelForImageSegmentation.from_pretrained(
        str(model_dir), trust_remote_code=True, local_files_only=True,
    ).to(device=device, dtype=dtype).eval()
    transform = transforms.Compose([
        transforms.Resize((1024, 1024)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    batch_size = 2 if device.type in {"mps", "cuda"} else 1
    outputs: list[Path] = []
    with torch.inference_mode():
        for offset in range(0, len(frame_paths), batch_size):
            batch_paths = frame_paths[offset : offset + batch_size]
            images = [Image.open(path).convert("RGB") for path in batch_paths]
            width, height = images[0].size
            inputs = torch.stack([transform(image) for image in images]).to(device=device, dtype=dtype)
            prediction = model(inputs)[-1].sigmoid().float()
            prediction = torch.nn.functional.interpolate(
                prediction, size=(height, width), mode="bilinear", align_corners=False,
            ).cpu().numpy()
            for path, mask in zip(batch_paths, prediction[:, 0], strict=True):
                target = output_dir / path.name
                Image.fromarray(np.round(np.clip(mask, 0, 1) * 255).astype(np.uint8), "L").save(target)
                outputs.append(target)
            progress(8 + int(42 * min(offset + len(batch_paths), len(frame_paths)) / len(frame_paths)), "正在运行 BiRefNet 毛发抠图")
    return outputs


def _choose_seed_frame(alpha_paths: list[Path], seed_threshold: float = 0.5) -> int:
    import numpy as np
    from PIL import Image

    candidates: list[tuple[float, int]] = []
    for index, path in enumerate(alpha_paths):
        alpha = np.asarray(Image.open(path).convert("L"), dtype=np.uint8)
        coverage = float((alpha >= round(seed_threshold * 255)).mean())
        if 0.01 <= coverage <= 0.90:
            candidates.append((coverage, index))
    if not candidates:
        raise RuntimeError("无法自动找到清晰主体帧")
    return max(candidates)[1]


def _run_sam2(
    sam_frames: Path,
    seed_alpha_path: Path,
    seed_index: int,
    output_dir: Path,
    root: Path,
    progress: Progress,
    seed_point: tuple[float, float] | None = None,
    seed_threshold: float = 0.5,
) -> None:
    import numpy as np
    import torch
    from PIL import Image
    from sam2.build_sam import build_sam2_video_predictor

    # MPS produced corrupted checker/noise masks in the project golden clip.
    # Fail closed to CPU on macOS until a separately validated backend ships.
    device = torch.device("cuda" if torch.cuda.is_available() and platform.system() == "Windows" else "cpu")
    checkpoint = root / "models" / "sam2" / "sam2.1_hiera_base_plus.pt"
    predictor = build_sam2_video_predictor(
        "configs/sam2.1/sam2.1_hiera_b+.yaml",
        str(checkpoint),
        device=device,
        apply_postprocessing=False,
    )
    state = predictor.init_state(
        video_path=str(sam_frames),
        offload_video_to_cpu=True,
        offload_state_to_cpu=device.type == "cpu",
    )
    if seed_point is None:
        seed = (
            np.asarray(Image.open(seed_alpha_path).convert("L"))
            >= round(seed_threshold * 255)
        )
        predictor.add_new_mask(state, frame_idx=seed_index, obj_id=1, mask=seed)
    else:
        predictor.add_new_points_or_box(
            state,
            frame_idx=seed_index,
            obj_id=1,
            points=np.asarray([seed_point], dtype=np.float32),
            labels=np.asarray([1], dtype=np.int32),
        )
    frame_count = len(list(sam_frames.glob("*.jpg")))
    completed = 0
    for reverse in (False, True):
        for frame_index, _, logits in predictor.propagate_in_video(
            state, start_frame_idx=seed_index, reverse=reverse,
        ):
            mask = (logits[0] > 0).to(torch.uint8).mul(255).cpu().numpy()
            if mask.ndim == 3:
                mask = mask[0]
            Image.fromarray(mask, "L").save(output_dir / f"{frame_index + 1:06d}.png")
            completed += 1
            progress(52 + int(33 * min(completed, frame_count) / frame_count), "正在使用 SAM 2.1 双向跟踪主体")


def _fuse_masks(
    alpha_paths: list[Path],
    sam_dir: Path,
    output_dir: Path,
    progress: Progress,
    parameters: MattingParameters,
) -> None:
    import cv2
    import numpy as np

    for index, alpha_path in enumerate(alpha_paths, start=1):
        alpha = cv2.imread(str(alpha_path), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255.0
        tracked = cv2.imread(str(sam_dir / alpha_path.name), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255.0
        fused = fuse_alpha_arrays(alpha, tracked, parameters)
        cv2.imwrite(str(output_dir / alpha_path.name), np.round(fused * 255).astype(np.uint8))
        progress(87 + int(6 * index / len(alpha_paths)), "正在融合时序身份与毛发 alpha")


def _encode_webm(frames: Path, masks: Path, output: Path, frame_rate: float, root: Path) -> None:
    ffmpeg = executable(root, "ffmpeg")
    subprocess.run([
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-framerate", f"{frame_rate:.8f}", "-start_number", "1", "-i", str(frames / "%06d.png"),
        "-framerate", f"{frame_rate:.8f}", "-start_number", "1", "-i", str(masks / "%06d.png"),
        "-filter_complex", "[0:v]format=rgba[color];[1:v]format=gray[alpha];[color][alpha]alphamerge,format=yuva420p[out]",
        "-map", "[out]", "-an", "-c:v", "libvpx", "-deadline", "good", "-cpu-used", "4",
        "-crf", "18", "-b:v", "0", "-auto-alt-ref", "0",
        "-metadata:s:v:0", "alpha_mode=1", str(output),
    ], check=True)


def _encode_macos_preview(source: Path, output: Path, root: Path) -> None:
    ffmpeg = executable(root, "ffmpeg")
    subprocess.run([
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-c:v", "libvpx", "-i", str(source), "-an", "-vf", "format=bgra",
        "-c:v", "hevc_videotoolbox", "-allow_sw", "1", "-alpha_quality", "1",
        "-tag:v", "hvc1", "-movflags", "+faststart", "-f", "mov", str(output),
    ], check=True)


def _write_metadata(
    output: Path,
    probe: VideoProbe,
    width: int,
    height: int,
    start: float,
    end: float,
    seed_index: int,
    frame_count: int,
    subject_selection: SubjectSelection,
    matting_parameters: MattingParameters,
) -> None:
    metadata = {
        "schemaVersion": 1,
        "pipeline": "sam2-birefnet-v1",
        "source": asdict(probe),
        "output": {"width": width, "height": height, "startSeconds": start, "endSeconds": end},
        "seedFrame": seed_index,
        "frameCount": frame_count,
        "alphaMode": "straight",
        "subjectSelection": asdict(subject_selection),
        "mattingParameters": asdict(matting_parameters),
    }
    output.with_suffix(".json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
