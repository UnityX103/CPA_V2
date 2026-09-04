---
name: cpa-v2-extension-packs
description: Design, add, migrate, review, or troubleshoot CPA_V2 downloadable extension packs and their reusable common-pack dependencies. Use whenever work adds or changes an optional video, pet, AI, runtime, or feature module; its dynamic settings contribution; its install/update/enable/disable/uninstall lifecycle; or its signed layered package contract. Do not use for ordinary features that intentionally remain bundled in the CPA core.
---

# CPA V2 Extension Packs

Keep optional functionality independently downloadable without weakening CPA's native security boundary or making the settings UI depend on a permanently bundled feature.

## Before changing code

1. Read [references/extension-contract.md](references/extension-contract.md). It defines ownership, dependency, lifecycle, settings-contribution, event, storage, and compatibility invariants.
2. Identify whether the requested work is a reusable **common pack** or a user-facing **feature pack**. A feature that needs a large/runtime dependency must depend on a common pack rather than embedding it.
   - When adding a second feature to an existing family such as `pet.*`, also read [references/multi-feature-family.md](references/multi-feature-family.md) before designing storage, dependency guards, progress, or settings navigation.
3. Inspect the current registry and native adapter before choosing new IDs or commands:
   - `app/src/domain/extensionPacks.ts`
   - `app/src-tauri/src/extension_packs.rs`
   - `app/src/extensions/`
4. If the work changes settings UI, inspect `AUI/PUI.pen` only through Pencil MCP. Never read or edit the encrypted file directly. If Pencil MCP is unavailable, implement no unreviewed visual divergence: report the design-source sync as a blocker or obtain an approved mockup first.
5. Resolve behavior that the module contract cannot safely guess: whether its settings are a unique sidebar tab or a family subpage; whether paused phases count as active; delay/presence requirements; settings fields and ranges; source/license/distribution; and whether common dependency versions may coexist. Ask only when the answer materially changes the design.

## Implementation rules

- Treat native status as authoritative. Frontend state mirrors Tauri command results and `extension-pack-status-changed`; it must not infer installation from UI state.
- Add pack metadata once to the TypeScript registry. Derive grouping, dependency display, dynamic tabs, and settings contributions from the descriptor instead of adding parallel ID lists or switches.
- Model dependency edges as plural. A common pack may have many dependents; never use a single `dependent_id` or first-match lookup for disable, uninstall, compatibility, progress, or UI messaging.
- Route package lifecycle exclusively through the unified native commands. Feature pages may expose feature actions such as “打开” or “模拟”, but not duplicate download, upgrade, enable/disable, or uninstall controls.
- Installing a feature resolves and verifies its common dependencies first. Disabling or uninstalling a common pack must be rejected while an enabled or installed dependent still requires it.
- Keep enablement device-local and enforce it in native launch paths. UI hiding is not an authorization boundary.
- Preserve common components when a layered feature is uninstalled. Never pretend a legacy monolithic package can be split; require upgrading it to a layered package before feature-only uninstall.
- Verify signed indexes, package hashes, manifest hashes, every declared file, target architecture, ABI/dependency compatibility, and path safety before atomically changing active pointers.
- Put macOS and Windows differences under `src-tauri/src/<feature>/{macos,windows}.rs` behind one platform-neutral command surface.
- The CPA core publishes the generic `pomodoro-broadcast-v1` contract. Pet-specific subscriptions and trigger policy belong to the signed feature manifest's `runtimeContribution`, not to the core or `pet.core`. The generic runtime may interpret declarations; legacy built-in adapters are compatibility-only.
- Treat activation gates as allow-listed host capabilities. A safe-looking manifest string is not enough: register the gate resolver and reject unknown gates. Declare whether phase activation also requires `isRunning` when pause semantics matter.
- Do not load arbitrary remote React or JavaScript into the settings window. Settings renderers are trusted host adapters selected by registered, signed pack metadata.
- Do not publish, sign, tag, upload, or alter release state unless the user explicitly requests release work.

## Verification

Read [references/validation.md](references/validation.md) and run the checks that match the changed layers. At minimum, cover dependency resolution, lifecycle guards, dynamic settings visibility, native enablement enforcement, and any new manifest fields through public seams.

After every completed project-file modification, run `graphify update .` from the repository root as required by `AGENTS.md`. Report warnings separately from failures.
