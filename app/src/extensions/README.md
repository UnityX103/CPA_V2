# Extension integrations

This directory owns feature-specific host integrations. The CPA core exposes generic extension
state and the versioned Pomodoro broadcast; it does not contain pet-specific trigger policy.

Feature runtimes are loaded through `runtime.ts` only while their signed extension pack is installed
and enabled. The Cockroach subscriber and eligibility policy therefore live under
`cockroachInvasion/`, separate from both the core Pomodoro domain and the reusable `pet.core`
runtime/dependency pack. `pomodoroBroadcastClient.ts` consumes the public
`pomodoro-broadcast-v1` Tauri event instead of subscribing to the Pomodoro Zustand store.
