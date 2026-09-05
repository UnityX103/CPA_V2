# Cockroach event/action rules

The Cockroach feature settings expose an ordered, editable list of public Pomodoro events and
allow-listed actions. A row has one event and one action; multiple rows may use the same event.
Rules are device-local, explicitly saved, capped at 32 rows, and initially empty. Saving an empty
list disables automatic actions. This replaces the Cockroach adapter's former fixed break/presence
policy and its `breakPetMode` gate; camera detection is still required for workstation events.

## Public events

`pomodoro-broadcast-v1` retains its existing envelope and adds optional `workstationPresence` and
`signals` fields plus a `presence.changed` observation type. These contain no camera frames.

| Signal | Label | Trigger |
| --- | --- | --- |
| `focus.started` | 专注开始 | First start of a focus phase; not every resume |
| `focus.ended` | 专注结束 | Timer completion or skip out of focus |
| `break.started` | 休息开始 | First start of a break phase |
| `break.ended` | 休息结束 | Timer completion or skip out of break |
| `break.present` | 休息时在工位上 | A running break and confirmed presence first coincide |
| `focus.present` | 专注时在工位上 | A running focus and confirmed presence first coincide |

Presence conditions fire once per arrival, re-arm after absent/unknown or a new phase, and never
repeat on ticks or pause/resume while the user stays present. Snapshot replies do not replay rules.
Manual resets do not emit an end signal. Simultaneous matching signals execute their rows in list order.

## Feature actions

| Action | Label | Behavior |
| --- | --- | --- |
| `kill-all` | 杀死所有蟑螂 | Kill the current population; keep the process alive |
| `spawn-one` | 开始繁殖蟑螂 | Add one cockroach subject to maxCount; launch with one if not running |
| `start-simulation` | 开始模拟蟑螂 | Launch with one cockroach; add one if already running |
| `stop-simulation` | 停止模拟 | Stop the process and clean up its control files |

`pet.cockroach-invasion` declares supported events/actions in the signed logic manifest's
`runtimeContribution.eventRules`. Existing manifests remain readable through the registered feature
adapter. The adapter consumes only the public Pomodoro transport; the reusable pet runtime has no
Pomodoro-specific policy. The legacy fixed-policy fields remain parseable for older hosts.

Rules are written atomically to `modules/cockroach-electron/data/cpa-automation.json`, separate from
the upstream simulation's config. Saving emits `cockroach-automation-rules-changed`; the active adapter
replaces its rules without replaying the current phase or restarting the process. Actions are queued
in order; a saved revision cancels old pending actions. Disabling/unloading cancels queued work and
stops after an in-flight action completes. Native actions check pack enablement and serialize with
manual process/config/control operations. Failures are surfaced in the settings panel.

The reviewed Electron patch adds a nonce-acknowledged `spawn-one` control command. It calls the
upstream capped `manager.spawn` once, using a random on-screen position. Older installed logic packs
cannot handle this command while already running and report an upgrade error. Publishing/installing
a new logic pack is required for that path; the shared Electron runtime/dependencies are unchanged.

## Validation

- Public broadcast tests cover phase starts/ends, pause/resume, presence edge detection, and snapshots.
- Rule adapter tests cover ordered actions, duplicates, saves, empty lists, cancellation, and errors.
- UI tests cover available options, add/edit/delete/save, and read failures.
- Native tests cover rule persistence/validation and nonce acknowledgements for kill and spawn.
- Package tests run the generated main/renderer control patch and validate its pinned source hashes.
