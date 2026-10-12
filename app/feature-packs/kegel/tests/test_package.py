import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('kegel_build_pack', ROOT / 'build_pack.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class KegelPackTests(unittest.TestCase):
    def test_separate_archive_has_verified_files_manifest_and_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dist = root / 'dist'
            dist.mkdir()
            (dist / 'index.html').write_text('<script src="module.js"></script>', encoding='utf-8')
            (dist / 'module.js').write_text('console.log("module")', encoding='utf-8')
            metadata = builder.build_pack(dist, root / 'out', '1.0.0')
            archive = root / 'out' / metadata['archive']
            self.assertEqual(metadata['sha256'], hashlib.sha256(archive.read_bytes()).hexdigest())
            with zipfile.ZipFile(archive) as package:
                manifest_bytes = package.read('manifest.json')
                self.assertEqual(metadata['manifestSha256'], hashlib.sha256(manifest_bytes).hexdigest())
                manifest = json.loads(manifest_bytes)
                self.assertEqual(manifest['id'], 'wellness.kegel')
                self.assertEqual(manifest['dependencies'], [])
                self.assertEqual(manifest['runtimeContribution']['settingsGate'], 'wellness.kegel')
                self.assertFalse(manifest['requiresRunning'])
                for entry in manifest['files']:
                    data = package.read(entry['path'])
                    self.assertEqual(entry['size'], len(data))
                    self.assertEqual(entry['sha256'], hashlib.sha256(data).hexdigest())
            repeated = builder.build_pack(dist, root / 'second', '1.0.0')
            self.assertEqual(metadata['sha256'], repeated['sha256'])

    def test_no_module_payload_in_core_entry(self):
        app = ROOT.parents[1]
        for path in ('src/main.tsx', 'src/App.tsx', 'src/domain/pomodoro.ts'):
            source = (app / path).read_text(encoding='utf-8')
            for payload in ('KegelApp', 'kegelAudio', 'advanceKegel', 'recordKegelReps', 'KegelView'):
                self.assertNotIn(payload, source)

    def test_missing_frontend_and_unapproved_release_source_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(ValueError):
                builder.build_pack(root / 'empty', root / 'out', '1.0.0')
            dist = root / 'dist'
            dist.mkdir()
            (dist / 'index.html').write_text('module', encoding='utf-8')
            (dist / 'module.js').write_text('module', encoding='utf-8')
            with self.assertRaises(ValueError):
                builder.build_pack(dist, root / 'out', '1.0.0', 'https://example.com')


if __name__ == '__main__':
    unittest.main()
