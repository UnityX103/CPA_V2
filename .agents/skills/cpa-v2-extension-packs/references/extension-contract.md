# CPA V2 extension contract

Use this reference for any extension-pack implementation or review.

## Ownership model

| Pack | Kind | Owns | Must not own |
|---|---|---|---|
| `video.core` | common | Platform engine, model bridge, shared models, FFmpeg/FFprobe | Video-editor UI or business workflow |
| `video.editor` | feature | Video-editor logic/UI package and Open action in the extension manager | Duplicate engine/model payloads |
| `pet.core` | common | Electron runtime, shared dependencies, process lifecycle and control protocol | Pomodoro/presence policy or a Cockroach-specific event bridge |
| `pet.cockroach-invasion` | feature | Cockroach logic, settings contribution and signed runtime policy | A private Pomodoro implementation |

New families should follow `<family>.core` for reusable dependencies and `<family>.<feature>` for user-facing behavior. Do not invent a common pack when nothing is reusable or large enough to justify an independent lifecycle.

## Canonical code seams

- Frontend catalog/store: `app/src/domain/extensionPacks.ts`
- Extension manager UI: `app/src/ui/ExtensionPackManagerTab.tsx`
- Dynamic settings outlet: `app/src/ui/ExtensionSettingsOutlet.tsx`
- Runtime contributions: `app/src/extensions/runtime.ts`
- Generic event runtime: `app/src/extensions/eventDrivenRuntime.ts`
- Pomodoro publisher: `app/src/domain/pomodoroBroadcast.ts`
- Native manager: `app/src-tauri/src/extension_packs.rs`
- Video adapter: `app/src-tauri/src/video_editor_module.rs`
- Pet/Cockroach adapter: `app/src-tauri/src/cockroach_module.rs`

The TypeScript descriptor is the presentation registry. Native Rust remains authoritative for installed files, enablement, dependency protection and process state. A new native family needs an adapter in Rust, but metadata must not be copied into several frontend arrays or components. Dependency queries return all matching dependents, not a single optional dependent.

## Lifecycle commands

The settings manager uses only:

- `extension_pack_statuses`
- `install_extension_pack`
- `set_extension_pack_enabled`
- `uninstall_extension_pack`

Runtime activation uses the allow-listed `set_extension_pack_active`. Feature launch commands must also call `pack_is_enabled`; a hidden tab alone cannot prevent launch.

Every successful mutation emits `extension-pack-status-changed` with the changed pack ID and the complete status set. Consumers restart only the changed pack and its affected dependencies, never every runtime.

Progress events must carry or deterministically resolve the initiating pack ID. Do not default every event in a family to the first existing feature once multiple features share that family.

### Install or upgrade

1. Fetch the CNB-first signed index with GitHub fallback.
2. Validate index signature and release/distribution policy.
3. Resolve dependency versions for the target platform.
4. Download only missing content-addressed components.
5. Validate archive size, SHA-256, manifest SHA-256, all declared file hashes, safe relative paths and platform ABI.
6. Install into staging and atomically update `core.json` or `current.json` only after the whole graph is valid.
7. Preserve prior enablement during upgrade. A newly installed feature and its required common pack start enabled.

If a common pack is upgraded while a feature is installed, update through the full compatible feature transaction so `current.json` cannot keep pointing at stale incompatible components.

When several features share one common pack, validate every installed dependent before switching the common pointer. Either find one version graph satisfying all dependents or retain compatible content-addressed versions side by side; never silently break one feature to upgrade another.

### Disable

Before persisting `enabled: false`, confirm window closure, child-process exit, and feature control/ack cleanup. Failure leaves the stored enabled state unchanged and returns an error.

Disabling a feature removes its settings contribution and stops its runtime without deleting files. Disabling a common pack is blocked while an enabled dependent uses it.

### Uninstall

Uninstalling a layered feature stops it, preserves its verified common components, removes feature logic and its active feature pointer, then emits new status. Common-pack uninstall is blocked while any dependent remains installed.

Schema-v1 monolithic packages are readable for launch compatibility but cannot be feature-only uninstalled. Require a successful layered upgrade first.

## Settings contributions

A feature descriptor may contribute one trusted settings renderer with `tab`, `label`, `order`, and `renderer`. The sidebar shows it only when native status is both `installed` and `enabled`. If the active feature becomes unavailable, return to the extension manager. A feature requesting its own sidebar entry needs a unique tab ID; features intentionally sharing a family tab need an outlet that composes all enabled contributions rather than selecting the first match.

Keep package lifecycle controls in the extension manager. Features can register an allow-listed Open action on their manager card without contributing a sidebar settings tab; `video.editor` uses this path. A contributed feature page contains only its functional settings and actions.

Implement settings surfaces directly in React/TypeScript and native CSS using the user’s requirements, supplied screenshots, and existing UI conventions. Completion requires checking the rendered interface and its interactions; no Pencil files or design-source synchronization are maintained.

## Runtime contribution manifest

Feature-owned event policy is carried in the signed logic manifest:

```json
{
  "runtimeContribution": {
    "eventContract": "pomodoro-broadcast-v1",
    "activationPhase": "break",
    "delayMs": 60000,
    "requiresPresence": true,
    "settingsGate": "cockroachInvasion"
  }
}
```

Validate contract name, supported phase, bounded delay and a registered settings-gate capability in Rust. New policy fields must be packaged, hashed and tested with the feature logic. The generic runtime interprets this declaration and calls the allow-listed native activation command. Do not add a pet-specific bridge to `pet.core`.

If “active during a phase” depends on whether the timer is running, add and validate an explicit signed field such as `requiresRunning`; do not infer pause semantics from the phase name. Likewise, presence and delay defaults must be explicit contract decisions.

The Pomodoro event contains version, sequence, timestamp, type, current/previous phase, running state, round counts, remaining seconds and reason. Subscribers obtain the initial snapshot through the public Tauri request/reply event, not by reaching into the Pomodoro Zustand store.

### User-configured event/action rules

The Cockroach feature now owns an ordered event/action rule list. Its logic manifest additionally
publishes `runtimeContribution.eventRules` with `events` and `actions` allow-lists. The public
Pomodoro envelope adds `signals` and `workstationPresence`; the core emits generic lifecycle/presence
signals, and the feature adapter alone chooses actions. Native settings are stored separately from
upstream simulation data. Empty rules mean no automatic actions, and saving rules replaces queued
work without replaying the current snapshot. The older fixed-policy fields are compatibility metadata.
See `docs/superpowers/specs/2026-09-05-cockroach-event-action-rules.md` for exact event/action semantics.

## Security and release boundaries

- Keep the default app free of optional model/runtime payloads.
- Keep CSP and minimal Tauri capabilities enabled.
- Accept package URLs only from the approved GitHub/CNB release paths (localhost is debug-only).
- Do not execute a manifest-provided shell command. Map validated pack IDs to allow-listed native adapters.
- Do not overwrite a working pointer until every new component is compatible and verified.
- A release must provide macOS ARM64, macOS x86_64 and Windows x86_64 artifacts where the family requires platform runtimes.
- Choose and record source provenance, licenses, and distribution per new feature. Do not inherit the Cockroach module's noncommercial policy unless the new sources actually require it.
- Publishing must keep CNB and GitHub indexes/assets synchronized and re-sign provider-specific indexes after URL rewriting.
