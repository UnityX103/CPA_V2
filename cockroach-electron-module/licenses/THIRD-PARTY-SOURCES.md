# Third-party sources

- CockroachPet-Public-Electron, MIT, pinned commit
  `a7d103d2818b40e12b8a39948e9ebf4c6085bfd3`:
  https://github.com/jo9900/CockroachPet-Public-Electron
- Electron 40.8.0, MIT plus bundled Chromium notices:
  https://github.com/electron/electron/tree/v40.8.0
- JavaScript production dependencies are pinned by the upstream
  `package-lock.json`; their package directories retain their individual
  `LICENSE` files inside the logic component.

CPA_V2 adds only the reviewed control-file and external dependency-root adapter documented by
`scripts/prepare_source.py`.
