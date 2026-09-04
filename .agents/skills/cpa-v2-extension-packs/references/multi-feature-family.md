# Adding another feature to an existing family

Read this when adding a second or later feature that reuses an existing common pack, such as another `pet.*` feature using `pet.core`.

## Decisions to settle first

- Does the feature need a unique left-sidebar settings tab, or a subpage inside a shared family tab?
- Does its phase trigger run while the Pomodoro timer is paused?
- Is activation immediate or delayed, and does it require confirmed presence?
- What settings fields, defaults, ranges, preview actions, and persistence scope does it own?
- What are the source, license, distribution, and platform-runtime requirements?
- Can its ABI/dependency set coexist with current family features, or must the common pack version solve all dependents together?

Do not invent these answers when they alter behavior, licensing, downloads, or navigation.

## Storage and migration

One family-level `current.json` cannot represent several independently upgradable features. Use one common pointer and one pointer per feature, conceptually:

```text
modules/<family>/
  core.json
  common/<content-addressed-components>/
  features/<pack-id>/current.json
  features/<pack-id>/logic/<content-addressed-component>/
  data/<pack-id>/
```

Existing video and Cockroach paths predate this generalized layout. Add a tested migration that registers or moves their content-addressed components without re-downloading them. Keep the last working pointers until every migrated component validates.

Uninstalling one feature removes only its feature pointer, logic, and feature-owned data chosen by the user. It does not remove sibling features or common components. Common uninstall remains blocked while any feature pointer exists.

## Plural dependency behavior

- Replace single-dependent helpers with `dependents_for(common_id) -> all dependents`.
- Disable is blocked when any installed dependent is enabled.
- Uninstall is blocked when any dependent is installed.
- Common upgrade validates every installed dependent's ABI/dependency constraints before pointer activation.
- UI guard text lists or summarizes every blocker.
- Progress identifies the actual initiating pack; family-level fallback IDs are not acceptable.

## Settings contributions

For a unique sidebar column, add a unique settings tab ID and trusted renderer registration. For a shared family column, the outlet must render or route among every enabled contribution deterministically; never use `.find()` and silently drop later features.

Remote manifests select only allow-listed renderer and activation-gate IDs. They never provide React code, shell commands, executable paths, or unchecked store paths.

## Runtime gates

Register every `settingsGate` with a trusted host resolver. The signed manifest may select a registered gate but cannot define arbitrary state traversal. If phase activation excludes paused time, add an explicit `requiresRunning` field to the shared Rust/TypeScript schema and cover both running and paused events.

New feature manifests own their event policy. Do not add another built-in feature controller unless it is a clearly marked, temporary migration adapter for already-installed legacy packages.
