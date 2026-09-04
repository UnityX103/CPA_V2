# Extension-pack validation

Run the narrow tests while iterating, then the relevant full suites before handoff.

## Required behavioral coverage

- Installing a feature returns both the feature and its common dependency as installed.
- Upgrade preserves enablement and does not restart unrelated extension runtimes.
- Native launch rejects a disabled feature even when called directly.
- Disabling a feature confirms process/window/control cleanup before persisting state.
- Disabling a common pack is blocked by an enabled dependent.
- Uninstalling a common pack is blocked by any installed dependent.
- Multiple dependents of one common pack are all considered by guards, version solving, progress routing, and UI messaging.
- Layered feature uninstall preserves common components and `core.json`.
- Legacy monolithic feature uninstall fails without first stopping or deleting the working package.
- Only installed and enabled features contribute settings tabs; disabling the active feature returns to extension management.
- Feature pages contain no duplicate package lifecycle actions.
- Runtime policy is present in the packaged feature manifest, passes native validation, and reacts to the public Pomodoro event contract.
- Unknown activation gates are rejected; `requiresRunning`, presence, and delay semantics are covered when the feature uses them.
- Package archives reject traversal, bad hashes, wrong targets and incompatible ABI/dependency sets.

## Frontend

Focused examples:

```bash
cd app
npx vitest run src/domain/extensionPacks.test.ts
npx vitest run src/domain/pomodoroBroadcast.test.ts
npx vitest run src/extensions/eventDrivenRuntime.test.ts
npx vitest run src/ui/ExtensionPackManagerTab.test.tsx
npx vitest run src/ui/SettingsPanel.test.tsx
npm run build
```

Full suite:

```bash
cd app && npm test
```

## Native host

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml
```

Keep macOS, Windows and unsupported implementations behind the same neutral module. A macOS-only local run does not prove Windows behavior; inspect Windows compilation paths and call out any unverified platform work.

## Package contracts

For Cockroach logic/runtime changes:

```bash
python3 -m unittest discover -s cockroach-electron-module/tests
```

For video logic/runtime/model changes:

```bash
python3 -m unittest discover -s video-editor-module/tests
```

If release scripts change, also run their adjacent Node tests under `app/scripts/` through Vitest.

## Repository completion

```bash
uv run --with pyyaml python ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/cpa-v2-extension-packs
graphify update .
```

Graphify warnings must be reported when relevant; a failed update blocks completion. Do not stage or overwrite unrelated user changes in `graphify-out/`.
