"""Build an independent Kegel webview pack; this script never signs or publishes."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT.parents[1]

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def build_pack(dist: Path, output: Path, version: str, base_url: str | None = None) -> dict:
    if not re.fullmatch(r'[0-9A-Za-z]+(?:[.\-+][0-9A-Za-z]+)*', version):
        raise ValueError('Invalid module version')
    files = {path.relative_to(dist).as_posix(): path.read_bytes() for path in sorted(dist.rglob('*')) if path.is_file()}
    if 'index.html' not in files or not any(name.endswith('.js') for name in files):
        raise ValueError('Build the module frontend before packaging')
    for dependency in ('react', 'react-dom', '@tauri-apps/api'):
        dependency_root = APP / 'node_modules' / dependency
        licenses = sorted(dependency_root.glob('LICENSE*'))
        if licenses:
            name = dependency.replace('@', '').replace('/', '-')
            files[f'notices/{name}.txt'] = licenses[0].read_bytes()
    files['notices/feature-source.txt'] = b'Kegel feature: original CPA_V2 project code. Third-party notices are included separately.\n'
    contract = json.loads((ROOT / 'module-contract.json').read_text(encoding='utf-8'))
    manifest = {**contract, 'version': version, 'files': [
        {'path': name, 'size': len(data), 'sha256': sha256(data)} for name, data in files.items()
    ]}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'kegel-module-{version}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, (2026, 10, 10, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            package.writestr(info, data)
        info = zipfile.ZipInfo('manifest.json', (2026, 10, 10, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        package.writestr(info, manifest_bytes)
    data = archive.read_bytes()
    metadata = {'id': contract['id'], 'version': version, 'archive': archive.name,
                'sha256': sha256(data), 'manifestSha256': sha256(manifest_bytes), 'size': len(data),
                'runtimeAbi': contract['runtimeAbi'], 'targets': contract['targets'], 'signed': False}
    (output / 'build-info.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    (output / 'SHA256.txt').write_text(f"{metadata['sha256']}  {archive.name}\n", encoding='ascii')
    if base_url:
        if not re.fullmatch(r'https://(?:github\.com/UnityX103/CPA_V2/releases/download/|cnb\.cool/nanzhaigame-xpy/CPA_V2/-/releases/download/)[^\s]+', base_url):
            raise ValueError('Index URL must use the approved exact release tag')
        index = {'schemaVersion': 1, 'id': contract['id'], 'version': version,
                 'runtimeAbi': contract['runtimeAbi'], 'distribution': contract['distribution'],
                 'url': base_url.rstrip('/') + '/' + archive.name, 'mirrors': [],
                 'size': len(data), 'sha256': metadata['sha256'], 'manifestSha256': metadata['manifestSha256']}
        (output / 'kegel-module-index.json').write_text(json.dumps(index, indent=2) + '\n', encoding='utf-8')
    return metadata

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', default='1.0.0')
    parser.add_argument('--dist', type=Path, default=APP / 'tmp/kegel-module/dist')
    parser.add_argument('--output', type=Path, default=APP / 'tmp/kegel-module/package')
    parser.add_argument('--release-base-url')
    args = parser.parse_args()
    print(json.dumps(build_pack(args.dist, args.output, args.version, args.release_base_url), ensure_ascii=False))
