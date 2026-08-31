# Third-party sources

The target-specific package also contains the license files collected from its
frozen Python environment and the audited FFmpeg build.

Core components:

- SAM 2.1, Apache-2.0: https://github.com/facebookresearch/sam2
- BiRefNet code and model card, MIT: https://github.com/ZhengPeng7/BiRefNet
- BiRefNet-matting weights: https://huggingface.co/ZhengPeng7/BiRefNet-matting
- PPM-100 alpha annotations, CC BY-NC-SA 4.0: https://github.com/ZHKKKe/PPM
- FFmpeg, LGPL-compatible build: https://ffmpeg.org/legal.html

`SOURCE-MANIFEST.json` contains the target-specific source revisions, build
configuration, and SHA-256 hashes. The public runtime archive repeats that
document as `source-manifest.json`, while `runtime-manifest.json` records the
platform-signature status and embeds the same provenance data.
