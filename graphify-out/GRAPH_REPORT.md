# Graph Report - .  (2026-08-31)

## Corpus Check
- Large corpus: 395 files · ~754,464 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 1972 nodes · 3751 edges · 134 communities (117 shown, 17 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 42 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- index.js
- mod.rs
- presence.ts
- PomodoroEndActionLayer.tsx
- lib.rs
- prepare-updater-release.mjs
- mod.rs
- .new()
- tauri.conf.json
- RoomManager.js
- permissions
- audio.rs
- SettingsPanel.tsx
- settings.ts
- UserDataStore.js
- windows.rs
- network.ts
- appUpdate.ts
- compilerOptions
- devDependencies
- scaled_window.rs
- Active App Multiplayer Payload
- bindingKey.ts
- useSettingsStore
- pomodoro.ts
- host.ts
- PomodoroPanel.tsx
- userPreferences.ts
- NativeError
- InputCounterPanel.tsx
- protocol.ts
- pomodoroSounds.ts
- compilerOptions
- window_layout.rs
- AuthStore.js
- App.tsx
- mod.rs
- OnlineSettingsPanel.tsx
- remotePlayerWindows.ts
- dependencies
- devDependencies
- cloudAccountData.ts
- key_counter.rs
- client.ts
- GlobalSettingsPanel.tsx
- launch_game.sh
- PlayerCard.tsx
- sound_files.rs
- video_files.rs
- prepare_playable_path()
- Open-source animal video matting research
- package.json
- DeskWindow.tsx
- Settings state and dispatch bridge
- CPA_V2 Release Publish
- network.test.ts
- updateConfig.test.ts
- CPA_V2 Tauri rewrite architecture
- Mirrored Check-in Windows
- CheckinPlanTemplate
- remotePlayerCardPositions.ts
- stub.rs
- page.tsx
- DevAlignApp.tsx
- updater.json
- active_app.rs
- windowPinConfig.test.ts
- PomodoroPanel.tsx
- Pomodoro End Action
- InputBindingBadge.tsx
- useNetworkStore
- windowLayoutConfig.test.ts
- compilerOptions
- Presence Observation
- macOS Accessibility permission gate
- Fixed Size Pomodoro Main Host
- checkinEnabled
- CPA_V2 Adversarial Review
- scripts
- InputCounterPanel.tsx
- PomodoroSettingsPanel.tsx
- Account Cloud Snapshot
- CPA to Tauri 2 and Rust Rewrite Design
- CPA_V2 Game Launcher
- cameraPermissionConfig.test.ts
- audioPlayback.ts
- soundFiles.ts
- userPreferencesPersistence.ts
- macos.rs
- prepare_playable_path()
- macos.rs
- PlayerCard.tsx
- CC0 sound provenance workflow
- Pencil Visual Source of Truth
- Settings Panel Dedicated Window and Pixel Parity Design
- package.json
- appExitConfig.test.ts
- remotePlayerWindows.test.ts
- inputCounterWindowConfig.test.ts
- stub.rs
- Main Thread Window Construction
- Shared Settings Apply Overlay
- Silent Signed Background Updates
- manifest.json
- font.test.ts
- VideoPlayerApp.tsx
- start.sh
- check-release-dependencies.sh
- Alternating-tripod crawl cycle
- open_settings()
- open_settings()
- Overlay Hit-Test Passthrough Design
- validate-macos-release.sh
- compare-player-card.mjs
- persistenceCapabilityConfig.test.ts
- layout.tsx
- next.config.ts
- Settings Panel Drag and Pixel-Parity Implementation Plan
- Windows Update Publish Implementation Plan
- Four-platform latest.json gate
- CPA_V2 HTML entry point
- @tauri-apps/cli
- @vitejs/plugin-react
- @vitest/coverage-v8
- Tauri React TypeScript app template
- next-env.d.ts
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `NativeError` - 36 edges
2. `useSettingsStore` - 29 edges
3. `App()` - 26 edges
4. `BridgeSnapshot` - 22 edges
5. `useNetworkStore` - 21 edges
6. `usePomodoroStore` - 21 edges
7. `ListenerHandle` - 19 edges
8. `BRIDGE_VERSION` - 19 edges
9. `permissions` - 18 edges
10. `compilerOptions` - 16 edges

## Surprising Connections (you probably didn't know these)
- `normalizeDataFile()` --indirect_call--> `snapshot()`  [INFERRED]
  Server/src/UserDataStore.js → app/src/domain/bridge/client.test.ts
- `main_panel_hit_test_subclass_proc()` --calls--> `point_in_rounded_rect()`  [INFERRED]
  app/src-tauri/src/window_helpers/windows.rs → app/src-tauri/src/window_helpers/mod.rs
- `AppUpdateStoreShape` --inherits--> `AppUpdateSnapshot`  [EXTRACTED]
  app/src/domain/userPreferences.ts → app/src/domain/appUpdate.ts
- `BindingKeyStoreShape` --references--> `BindingKeyEntry`  [EXTRACTED]
  app/src/domain/userPreferences.ts → app/src/domain/bindingKey.ts
- `SyncRemotePlayerWindowsInput` --references--> `RemotePlayer`  [EXTRACTED]
  app/src/domain/remotePlayerWindows.ts → app/src/domain/network.ts

## Import Cycles
- 3-file cycle: `app/src/domain/appUpdate.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/appUpdate.ts`
- 3-file cycle: `app/src/domain/bindingKey.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/bindingKey.ts`
- 3-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/pomodoro.ts -> app/src/domain/bridge/dispatch.ts`
- 3-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/network.ts -> app/src/domain/bridge/dispatch.ts`
- 3-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/presence.ts -> app/src/domain/bridge/dispatch.ts`
- 3-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/settings.ts -> app/src/domain/bridge/dispatch.ts`
- 4-file cycle: `app/src/domain/appUpdate.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/appUpdate.ts`
- 4-file cycle: `app/src/domain/appUpdate.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/appUpdate.ts`
- 4-file cycle: `app/src/domain/bindingKey.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/bindingKey.ts`
- 4-file cycle: `app/src/domain/bindingKey.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/bindingKey.ts`
- 4-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/network.ts -> app/src/domain/bridge/dispatch.ts`
- 4-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/pomodoro.ts -> app/src/domain/bridge/dispatch.ts`
- 4-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/settings.ts -> app/src/domain/bridge/dispatch.ts`
- 4-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/presence.ts -> app/src/domain/pomodoro.ts -> app/src/domain/bridge/dispatch.ts`
- 5-file cycle: `app/src/domain/appUpdate.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/appUpdate.ts`
- 5-file cycle: `app/src/domain/bindingKey.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/bindingKey.ts`
- 5-file cycle: `app/src/domain/audioPlayback.ts -> app/src/domain/settings.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/pomodoroSounds.ts -> app/src/domain/audioPlayback.ts`
- 5-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/network.ts -> app/src/domain/bridge/dispatch.ts`
- 5-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/pomodoro.ts -> app/src/domain/bridge/dispatch.ts`
- 5-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/settings.ts -> app/src/domain/bridge/dispatch.ts`

## Hyperedges (group relationships)
- **Cross-platform updater release gate** — agents_skills_cpa_v2_release_publish_skill_macos_dual_thin_builds, agents_skills_cpa_v2_release_publish_skill_windows_x64_nsis, agents_skills_cpa_v2_release_publish_skill_four_platform_manifest [EXTRACTED 1.00]
- **Animal video matting and transparent delivery pipeline** — docs_research_2026_08_31_pet_video_background_removal_oss_sam2_1, docs_research_2026_08_31_pet_video_background_removal_oss_birefnet, docs_research_2026_08_31_pet_video_background_removal_oss_transparent_delivery [EXTRACTED 1.00]
- **Settings-window source-of-truth bridge** — docs_superpowers_plans_2026_05_15_settings_panel_separate_window_main_source_of_truth, docs_superpowers_plans_2026_05_15_settings_panel_separate_window_settings_bridge, docs_superpowers_plans_2026_05_15_settings_panel_separate_window_store_factories [EXTRACTED 1.00]
- **Settings Window Interaction Integrity** — docs_superpowers_plans_2026_05_16_settings_crash_fix_main_thread_window_construction, docs_superpowers_plans_2026_05_16_settings_focus_restore_post_drag_focus_restoration, docs_superpowers_plans_2026_05_16_settings_panel_empty_area_drag_interactive_drag_target_classifier, docs_superpowers_plans_2026_05_17_settings_content_area_scroll_fixed_clipped_settings_shell [INFERRED 0.85]
- **Authoritative Main Window Mirror Flow** — docs_superpowers_plans_2026_05_18_active_app_logo_title_display_persisted_window_title_visibility, docs_superpowers_plans_2026_05_18_input_counter_panel_regression_lightweight_bridge_snapshot, docs_superpowers_plans_2026_05_19_remote_player_sync_remote_player_card_window_pool, docs_superpowers_plans_2026_05_20_daily_checkin_panels_mirrored_checkin_windows [INFERRED 0.85]
- **Authenticated Multiplayer Room Flow** — docs_superpowers_plans_2026_05_21_account_login_file_backed_auth_store, docs_superpowers_plans_2026_05_21_account_login_authenticated_websocket_rooms, docs_superpowers_plans_2026_05_21_account_login_room_gate_logged_in_room_control_gate, docs_superpowers_plans_2026_05_21_account_auth_status_reset_post_auth_network_idle_reset, docs_superpowers_plans_2026_05_19_remote_player_sync_remote_player_card_window_pool [INFERRED 0.85]
- **Account and Local Archive Durability Flow** — docs_superpowers_plans_2026_05_21_pomodoro_cloud_settings_account_cloud_snapshot, docs_superpowers_plans_2026_05_22_local_first_settings_sync_user_preferences_snapshot, docs_superpowers_plans_2026_05_22_offline_archive_and_window_layout_persistence_startup_archive_selection [EXTRACTED 1.00]
- **Check-in Lifecycle Control Flow** — docs_superpowers_plans_2026_05_23_checkin_global_toggle_checkin_enabled, docs_superpowers_plans_2026_06_16_settings_plan_panel_and_pet_removal_plan_panel_enabled, docs_superpowers_plans_2026_06_16_checkin_system_lifecycle_checkin_subsystem_lifecycle, docs_superpowers_plans_2026_06_16_checkin_system_lifecycle_mirror_panel_unmount [EXTRACTED 1.00]
- **Native Window Interaction Controls** — docs_superpowers_specs_2026_05_15_overlay_hit_passthrough_design_native_hit_test_passthrough, docs_superpowers_specs_2026_05_15_settings_panel_drag_and_pixel_parity_design_settings_webview_window, docs_superpowers_specs_2026_05_16_main_window_pin_design_main_window_pin_command, docs_superpowers_plans_2026_05_21_temporary_focus_windows_temporary_focus_command [INFERRED 0.85]

## Communities (134 total, 17 thin omitted)

### Community 0 - "index.js"
Cohesion: 0.05
Nodes (71): IconCache, IconCacheError, broadcastToRoom(), clearConnectionInitTimeout(), createPomodoroServer(), DEFAULT_PORT, ensureAuthenticated(), ensureConnectionNotInRoom() (+63 more)

### Community 1 - "mod.rs"
Cohesion: 0.10
Nodes (43): AccessibilityStatus, accessibility_status(), AccessibilityChangedPayload, AccessibilityStatus, app_bundle_root(), bundle_identifier(), code_sign_identifier(), current_status() (+35 more)

### Community 2 - "presence.ts"
Cohesion: 0.08
Nodes (40): presenceAutomationContextSignature(), applyLivePresenceSample(), applyPresenceCapability(), applyPresenceSample(), capabilityState(), createPresenceStore(), defaultMonitorRuntime, initialPresenceState() (+32 more)

### Community 3 - "PomodoroEndActionLayer.tsx"
Cohesion: 0.07
Nodes (32): FocusableAppWindowLabel, focusAppWindow(), { invokeMock }, PomodoroEndEvent, basename(), MaybePromise, PomodoroEndActionResolution, PomodoroEndActionRuntime (+24 more)

### Community 4 - "lib.rs"
Cohesion: 0.14
Nodes (39): ActiveAppInfo, apply_saved_window_layout(), best_monitor_rect_for_bounds(), build_input_counter_window_hidden(), build_settings_window_hidden(), close_settings_window(), contains_point(), fallback_video_screen_rect() (+31 more)

### Community 5 - "prepare-updater-release.mjs"
Cohesion: 0.10
Nodes (34): artifactMatchesVersion(), artifactUrl(), assertFreshSignature(), assertVersion(), copyIfExists(), DEFAULT_APP_ROOT, execFileAsync, githubAssetName() (+26 more)

### Community 6 - "mod.rs"
Cohesion: 0.09
Nodes (28): install_first_mouse_only(), install_focus_restorer(), install_main_panel_hit_test(), main_panel_corner_radius(), main_panel_hit_test_scales_with_the_window(), point_in_rounded_rect(), post_did_move_notification_for_testing(), AppHandle (+20 more)

### Community 7 - ".new()"
Cohesion: 0.12
Nodes (35): exit_cancellation_terminates_helper_promptly(), finish_stream_reader(), helper_payload_round_trips_success_and_structured_errors(), NativeErrorKind, parse_helper_output(), parse_stream_interval(), publish_stream_result(), read_stream_output() (+27 more)

### Community 8 - "tauri.conf.json"
Cohesion: 0.06
Nodes (35): app, macOSPrivateApi, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl (+27 more)

### Community 9 - "RoomManager.js"
Cohesion: 0.10
Nodes (21): clampString(), cloneRemoteState(), defaultRoomCodeFactory, EMPTY_ROOM_TTL_MS, getPriorityFingerprint(), MAX_PLAYER_NAME_LENGTH, MAX_PLAYER_STATE_UPDATES_PER_WINDOW, MAX_PLAYERS_PER_ROOM (+13 more)

### Community 10 - "permissions"
Cohesion: 0.06
Nodes (33): description, identifier, main, permissions, $schema, windows, autostart:allow-disable, autostart:allow-enable (+25 more)

### Community 11 - "audio.rs"
Cohesion: 0.12
Nodes (31): ActivePlayback, AudioOutputDevice, AudioPlaybackResult, AudioPlaybackState, AudioReader, builtin_sound_bytes(), list_audio_output_devices(), normalize_volume() (+23 more)

### Community 12 - "SettingsPanel.tsx"
Cohesion: 0.08
Nodes (23): PresenceAuthorizationAction, presenceAuthorizationView, accountErrorText(), AppUpdateSettingsRow(), appUpdateStatusText(), cloudSyncStatusText(), confirmedPresenceText(), EMPTY_APPLY_STATE (+15 more)

### Community 13 - "settings.ts"
Cohesion: 0.12
Nodes (24): applyAutostartEnabled(), readAutostartEnabled(), plugin, clampScale(), clampSoundVolume(), createDangerousChangeId(), createSettingsStore(), DANGEROUS_CHANGE_TIMEOUT_MS (+16 more)

### Community 14 - "UserDataStore.js"
Cohesion: 0.12
Nodes (21): snapshot(), clampNumber(), clampString(), cloneSnapshot(), DEFAULT_FILE_PATH, normalizeAppUpdate(), normalizeBindingInput(), normalizeBindingKey() (+13 more)

### Community 15 - "windows.rs"
Cohesion: 0.14
Nodes (26): availability_for_error(), classify_camera_error(), create_face_detector(), generic_camera_errors_keep_their_safe_pipeline_stage(), map_camera_error_at(), open_camera(), open_privacy_settings(), probe_camera_access() (+18 more)

### Community 16 - "network.ts"
Cohesion: 0.11
Nodes (26): clearPersistedAccountSession(), isPersistedAccountSessionV1(), loadPersistedAccountSession(), openStore(), PersistedAccountSession, PersistedAccountSessionV1, savePersistedAccountSession(), store (+18 more)

### Community 17 - "appUpdate.ts"
Cohesion: 0.11
Nodes (21): APP_UPDATE_CHECK_INTERVAL_MS, APP_UPDATE_REQUEST_TIMEOUT_MS, APP_UPDATE_STARTUP_DELAY_MS, AppUpdateActions, AppUpdateDeps, AppUpdateStatus, AppUpdateStore, createAppUpdateStore() (+13 more)

### Community 18 - "compilerOptions"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 19 - "devDependencies"
Cohesion: 0.07
Nodes (27): dependencies, next, react, react-dom, devDependencies, tailwindcss, @tailwindcss/postcss, @types/node (+19 more)

### Community 20 - "scaled_window.rs"
Cohesion: 0.18
Nodes (24): centered_origin(), centered_origin_places_window_in_monitor_center(), clamp_origin_keeps_preserved_windows_visible(), clamp_origin_to_monitor(), clamp_size_respects_monitor_margin_and_minimum_size(), clamp_size_to_monitor(), LogicalRect, LogicalSizePair (+16 more)

### Community 21 - "Active App Multiplayer Payload"
Cohesion: 0.11
Nodes (27): Active App Logo And Title Display, Active App Logo And Title Display Implementation Plan, Persisted Window Title Visibility, Enabled Binding Visibility Gate, Input Counter Panel Regression Implementation Plan, Lightweight Bridge Snapshot, Active App Multiplayer Payload, Remote Player Card Window Pool (+19 more)

### Community 22 - "bindingKey.ts"
Cohesion: 0.11
Nodes (23): AccessibilityStatus, applyHealth(), BindingKeyActions, BindingKeyPlatform, BindingKeyState, BindingKeyStore, createBindingKeyStore(), inputForLegacyKeyCode() (+15 more)

### Community 23 - "useSettingsStore"
Cohesion: 0.17
Nodes (18): useBridgeClient(), INPUT_COUNTER_BASE_HEIGHT, INPUT_COUNTER_BASE_WIDTH, MAIN_WINDOW_BASE_SIZE, ScaledWindowSizeOptions, SETTINGS_WINDOW_BASE_SIZE, SETTINGS_WINDOW_MIN_SIZE, { invokeMock } (+10 more)

### Community 24 - "pomodoro.ts"
Cohesion: 0.11
Nodes (19): ConfirmedDispatchOptions, createDispatchRequestId(), dispatch(), dispatchConfirmed(), ConfirmedDispatchRequest, DispatchResult, EVT_DISPATCH, EVT_DISPATCH_RESULT (+11 more)

### Community 25 - "host.ts"
Cohesion: 0.16
Nodes (23): activeAppIdentitySig(), activeAppSig(), applyDispatch(), appUpdateSig(), appUpdateSnapshot(), bindingKeySig(), buildSnapshot(), BuildSnapshotOptions (+15 more)

### Community 26 - "PomodoroPanel.tsx"
Cohesion: 0.10
Nodes (13): formatMmSs(), PomodoroPhase, usePresenceStore, ClockRingProps, ClockState, clockStateOf(), phaseLabel(), PomodoroPanel() (+5 more)

### Community 27 - "userPreferences.ts"
Cohesion: 0.17
Nodes (24): clonePomodoroEndSounds(), PersistedSettingsSnapshot, SettingsState, AppUpdateStoreShape, BindingKeyStoreShape, cloneInput(), DEFAULT_END_ACTION_VIDEO, defaultUserPreferencesSnapshot() (+16 more)

### Community 28 - "NativeError"
Cohesion: 0.18
Nodes (22): classify_camera_error(), default_camera_index(), detect_face(), map_camera_error(), open_camera(), open_privacy_settings(), request_access(), Camera (+14 more)

### Community 29 - "InputCounterPanel.tsx"
Cohesion: 0.18
Nodes (14): ActiveAppState, useActiveAppStore, hasVisibleInputCounterEntries(), isVisibleBindingEntry(), useBindingKeyStore, { invokeMock }, useInputCounterWindowController(), buildRemoteState() (+6 more)

### Community 30 - "protocol.ts"
Cohesion: 0.17
Nodes (21): ActiveAppInfo, AppUpdateSnapshot, BindingKeyEntry, BridgeSnapshot, DispatchPayload, AccountStatus, AccountUser, CloudSyncStatus (+13 more)

### Community 31 - "pomodoroSounds.ts"
Cohesion: 0.15
Nodes (21): playSound(), SoundSource, BREAK_END_SOUNDS, BuiltinPomodoroSound, builtinSoundForSelection(), DEFAULT_POMODORO_END_SOUNDS, defaultPlaybackDeps, FOCUS_END_SOUNDS (+13 more)

### Community 32 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+14 more)

### Community 33 - "window_layout.rs"
Cohesion: 0.23
Nodes (19): apply_layout(), empty_snapshot(), install_tracking(), is_supported_window_label(), load_layout(), normalize_layout(), read_snapshot(), AppHandle (+11 more)

### Community 34 - "AuthStore.js"
Cohesion: 0.19
Nodes (11): AuthStore, AuthStoreError, createSession(), createSessionToken(), DEFAULT_FILE_PATH, hashPassword(), normalizeAccountInput(), normalizeDataFile() (+3 more)

### Community 35 - "App.tsx"
Cohesion: 0.19
Nodes (17): App(), buildStartupSettingsSnapshot(), clampStartupScale(), getStartupSettingsState(), StartupArchiveSource, mocks, userPreferenceStores(), waitForAccountRestoreAttempt() (+9 more)

### Community 36 - "mod.rs"
Cohesion: 0.19
Nodes (18): camera_presence_status(), error_sample(), open_camera_privacy_settings(), platform(), prepare_for_run(), PresenceAvailability, PresenceCapability, PresenceObservation (+10 more)

### Community 37 - "OnlineSettingsPanel.tsx"
Cohesion: 0.10
Nodes (7): DEFAULT_HISTORY, DEFAULT_ROOM, OnlinePhase, OnlineSettingsPanelProps, PHASE_LABEL, RoomHistory, RoomMember

### Community 38 - "remotePlayerWindows.ts"
Cohesion: 0.17
Nodes (17): loadRemotePlayerCardPositions(), REMOTE_PLAYER_WINDOW_LABELS, RemotePlayerWindowLabel, Assignment, assignments, closeAllRemotePlayerWindows(), closeLabel(), defaultPosition() (+9 more)

### Community 39 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, react, react-dom, @tauri-apps/api, @tauri-apps/plugin-autostart, @tauri-apps/plugin-dialog, @tauri-apps/plugin-process, @tauri-apps/plugin-store (+11 more)

### Community 40 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, jsdom, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react, @types/react-dom, typescript (+11 more)

### Community 41 - "cloudAccountData.ts"
Cohesion: 0.18
Nodes (15): AppUpdateStore, BindingKeyStore, buildCloudAccountData(), cloneBindingKey(), cloneBindingKeyEntry(), cloudAccountDataKey(), CloudStores, hydrateCloudAccountData() (+7 more)

### Community 42 - "key_counter.rs"
Cohesion: 0.15
Nodes (10): InputPressedPayload, Arc, AtomicBool, Option, Result, Self, String, spawn_listener() (+2 more)

### Community 43 - "client.ts"
Cohesion: 0.21
Nodes (13): { listenMock, invokeMock }, applySnapshotToMirrors(), cloneActiveAppForMirror(), cloneDangerousChange(), cloneEntries(), clonePlayer(), clonePlayers(), hasIconDataProperty() (+5 more)

### Community 44 - "GlobalSettingsPanel.tsx"
Cohesion: 0.12
Nodes (3): BindingKey, DEFAULT_BINDINGS, GlobalSettingsPanelProps

### Community 45 - "launch_game.sh"
Cohesion: 0.32
Nodes (13): ensure_dirs(), ensure_npm(), is_pid_running(), is_port_open(), launch_game.sh script, start(), start_server(), start_tauri() (+5 more)

### Community 46 - "PlayerCard.tsx"
Cohesion: 0.18
Nodes (8): RemoteState, deriveBadge(), PhaseBadge, PlayerCard(), PlayerCardProps, { startDraggingMock }, NO_WINDOW_DRAG_SELECTOR, shouldStartWindowDrag()

### Community 47 - "sound_files.rs"
Cohesion: 0.27
Nodes (12): allow_sound_asset_file(), CustomSoundValidation, invalid(), prepare_custom_sound_path(), AppHandle, Option, Path, R (+4 more)

### Community 48 - "video_files.rs"
Cohesion: 0.27
Nodes (12): allow_video_asset_file(), CustomVideoValidation, invalid(), prepare_custom_alpha_video_path(), AppHandle, Option, Path, R (+4 more)

### Community 49 - "prepare_playable_path()"
Cohesion: 0.29
Nodes (14): alpha_cache_filename(), alpha_tmp_path(), cached_alpha_video_is_fresh(), ffmpeg_alpha_transcode_arguments(), prepare_playable_path(), AppHandle, Path, PathBuf (+6 more)

### Community 50 - "Open-source animal video matting research"
Cohesion: 0.14
Nodes (14): BiRefNet matting, Cutie, Open-source animal video matting research, GFM and AM-2K, HEVC with Alpha MOV, Publishable animal video matting pipeline, RGBA PNG frame-sequence master, SAM 2.1 (+6 more)

### Community 51 - "package.json"
Cohesion: 0.14
Nodes (13): nanoid, dependencies, nanoid, ws, description, name, private, scripts (+5 more)

### Community 52 - "DeskWindow.tsx"
Cohesion: 0.18
Nodes (6): MENU_ITEMS, PanelKey, IconTile(), IconTileProps, PetSettingsPanel(), PetSettingsPanelProps

### Community 53 - "Settings state and dispatch bridge"
Cohesion: 0.15
Nodes (13): Dedicated settings WebviewWindow, Dedicated Tauri Settings Window Implementation Plan, Main-window state source of truth, Settings state and dispatch bridge, Window-mode Zustand store factories, Dangerous settings preview-apply-revert flow, Five-second blocking confirmation dialog, Dangerous Global Settings Implementation Plan (+5 more)

### Community 54 - "CPA_V2 Release Publish"
Cohesion: 0.18
Nodes (12): CPA_V2 Release skill interface, Developer ID signing and Apple notarization, CPA_V2 Release Migration, Release capability migration, Parallels Windows x64 Release Build, Owned Parallels VM lifecycle, Windows ARM64 host environment to x64 MSVC build, Repo-local release credential pack (+4 more)

### Community 55 - "network.test.ts"
Cohesion: 0.17
Nodes (5): defaultServerUrl(), DEVELOPMENT_SERVER_URL, PRODUCTION_SERVER_URL, FakeWebSocket, persistedSession

### Community 56 - "updateConfig.test.ts"
Cohesion: 0.17
Nodes (8): appRoot, capabilitiesPath, cargoTomlPath, here, libRsPath, packageJsonPath, tauriConfPath, updaterCapabilitiesPath

### Community 57 - "CPA_V2 Tauri rewrite architecture"
Cohesion: 0.20
Nodes (12): CPA_V2 Tauri rewrite architecture, Platform-neutral Tauri native bridge, Native per-region mouse hit testing, Versioned multiplayer RemoteState protocol, CPA_V2 Codex repository guide, QFramework-inspired state layering, CPA_V2 Claude repository guide, CPAPassthroughView (+4 more)

### Community 58 - "Mirrored Check-in Windows"
Cohesion: 0.24
Nodes (12): Interactive Drag Target Classifier, Settings Panel Empty Area Drag, Settings Panel Empty Area Drag Implementation Plan, Daily Check-in Panels Implementation Plan, Daily Check-in Domain, Mirrored Check-in Windows, Check-in Editor Panel Drag Implementation Plan, Check-in Editor Panel Drag (+4 more)

### Community 59 - "CheckinPlanTemplate"
Cohesion: 0.18
Nodes (12): Check-in Day Inheritance, Check-in Editor Inherit Context Menu Implementation Plan, Check-in Row Context Menu, CheckinPlanTemplate, Check-in Item Repeat Plan Implementation Plan, Legacy Weekly Plan Migration, Item-Owned Repeat Days, DzDyI Count/Cycle Pixel Sync Implementation Plan (+4 more)

### Community 60 - "remotePlayerCardPositions.ts"
Cohesion: 0.24
Nodes (9): isRemotePlayerCardPosition(), normalizePositions(), openStore(), PersistedRemotePlayerCardPositionsV1, RemotePlayerCardPosition, RemotePlayerCardPositions, saveQueue, saveRemotePlayerCardPositionNow() (+1 more)

### Community 61 - "stub.rs"
Cohesion: 0.24
Nodes (10): open_privacy_settings(), request_access(), Duration, FnMut, PresenceAvailability, Result, String, sample() (+2 more)

### Community 62 - "page.tsx"
Cohesion: 0.20
Nodes (6): GlobalSettingsPanel(), OnlineSettingsPanel(), SettingsPanel(), SettingsPanelProps, SettingsTab, TABS

### Community 63 - "DevAlignApp.tsx"
Cohesion: 0.24
Nodes (8): DevAlignApp(), initialMode(), initialTargetId(), MOCK_PLAYER, Mode, PaneProps, Target, TARGETS

### Community 64 - "updater.json"
Cohesion: 0.20
Nodes (9): description, identifier, main, permissions, $schema, windows, process:allow-restart, updater:allow-check (+1 more)

### Community 65 - "active_app.rs"
Cohesion: 0.53
Nodes (9): ActiveAppInfo, AppWindowBounds, current_active_app(), current_active_app_front_window(), current_active_app_icon_data_url(), current_active_app_window_bounds(), current_active_app_window_title(), Option (+1 more)

### Community 66 - "windowPinConfig.test.ts"
Cohesion: 0.20
Nodes (4): accessibilityRsPath, here, libRsPath, tauriConfPath

### Community 67 - "PomodoroPanel.tsx"
Cohesion: 0.24
Nodes (6): Clock(), ClockProps, ClockState, STATE_LABELS, PomodoroPanel(), PomodoroPanelProps

### Community 68 - "Pomodoro End Action"
Cohesion: 0.27
Nodes (10): Check-in Window Pin Policy, Temporary Focus Windows Implementation Plan, Temporary Focus Command, Main Window Pin Design, Main-Window-Only Pin Command, No Default Always-On-Top, Bundled Qianqian Video, Custom WebM Validation and Popup Fallback (+2 more)

### Community 69 - "InputBindingBadge.tsx"
Cohesion: 0.28
Nodes (7): BindingInput, MouseButton, PersistedBindingKeyEntry, InputBindingBadge(), InputBindingBadgeProps, inputFromRemoteLabel(), MOUSE_LABEL_TO_BUTTON

### Community 70 - "useNetworkStore"
Cohesion: 0.36
Nodes (6): useNetworkStore, saveRemotePlayerCardPosition(), RemotePlayerCardApp(), routePlayerId(), {
    onMovedMock,
    savePositionMock,
    useBridgeClientMock,
}, RemoteRoster()

### Community 71 - "windowLayoutConfig.test.ts"
Cohesion: 0.22
Nodes (7): globalCssPath, here, libRsPath, macosWindowHelpersPath, tauriConfPath, windowHelpersPath, windowsWindowHelpersPath

### Community 72 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include, vite.config.ts

### Community 73 - "Presence Observation"
Cohesion: 0.22
Nodes (9): Absent, Confirmed Presence, CPA Desktop Pomodoro domain language, Manual Pause, Presence Observation, Presence-Owned Pause, Present, Unknown (+1 more)

### Community 74 - "macOS Accessibility permission gate"
Cohesion: 0.22
Nodes (9): Accessibility permission banner, Key Counter Accessibility Permission Gate Plan, macOS Accessibility permission gate, Key-counter ListenerHandle coordinator, One-hertz Accessibility watcher, set_main_window_pinned command, Main Window Pin Implementation Plan, HApJ0 pin control (+1 more)

### Community 75 - "Fixed Size Pomodoro Main Host"
Cohesion: 0.31
Nodes (9): Fixed Size Pomodoro Main Host, Native Passthrough Removal, Pomodoro Main Window Fit Panel Implementation Plan, Monitor Clamped Geometry, Scaled Window Sizing Implementation Plan, Shared Scaled Window Sizing, Auto Pin On Focus End, Auto Pin On Focus End Implementation Plan (+1 more)

### Community 76 - "checkinEnabled"
Cohesion: 0.28
Nodes (9): checkinEnabled, Check-in Flow Gating, Check-in Global Toggle Implementation Plan, Check-in Subsystem Lifecycle, Check-in System Lifecycle Implementation Plan, Mirror Panel Unmount Gate, Settings Plan Panel And Pet Removal Implementation Plan, Pet Settings Tab Removal (+1 more)

### Community 77 - "CPA_V2 Adversarial Review"
Cohesion: 0.25
Nodes (9): Pomodoro Accumulator Reset, CPA_V2 Adversarial Review, Least-Privilege Tauri Capabilities, WebSocket Protocol DoS Safety, Room-Scoped State Sync Deduplication, WebSocket Generation Guard, autoStartBreak, Pomodoro Auto-Start Break Setting Design (+1 more)

### Community 78 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, build, dev, preview, release:updater, tauri, test, test:player-card-visual

### Community 79 - "InputCounterPanel.tsx"
Cohesion: 0.25
Nodes (4): DEFAULT_PILLS, InputCounterPanel(), InputCounterPanelProps, InputCounterPill

### Community 81 - "Account Cloud Snapshot"
Cohesion: 0.36
Nodes (8): Account Cloud Snapshot, Pomodoro Cloud Settings Implementation Plan, Optimistic Conflict Merge, UserDataStore, Local-First Settings Sync Implementation Plan, Local-First Settings Sync, User Preferences Snapshot, Startup Archive Selection

### Community 82 - "CPA to Tauri 2 and Rust Rewrite Design"
Cohesion: 0.32
Nodes (8): CPA to Tauri 2 and Rust Rewrite Design, Domain-Service-IPC Layering, RemoteState Protocol, CPA Tauri Rewrite, Accessibility Permission Gate, Key Counter Accessibility Permission Gate Design, Key Counter Listener Lifecycle, Accessibility Permission Polling

### Community 83 - "CPA_V2 Game Launcher"
Cohesion: 0.29
Nodes (7): CPA_V2 Game Launcher, Non-destructive launcher process management, CPA_V2 local development runtime, Pomodoro MP Server, Node.js 25 test glob workaround, Single-node development WebSocket server, ws://127.0.0.1:8039

### Community 84 - "cameraPermissionConfig.test.ts"
Cohesion: 0.29
Nodes (5): here, infoPlistPath, presenceDetectionPath, tauriConfPath, tauriRoot

### Community 85 - "audioPlayback.ts"
Cohesion: 0.33
Nodes (5): AudioOutputDevice, AudioPlaybackResult, listAudioOutputDevices(), invoke, AudioSettingsCard()

### Community 86 - "soundFiles.ts"
Cohesion: 0.48
Nodes (5): customSoundSrc(), pickCustomMp3Path(), showCustomSoundMissingMessage(), mocks, validateCustomSoundPath()

### Community 87 - "userPreferencesPersistence.ts"
Cohesion: 0.48
Nodes (5): loadPersistedUserPreferences(), openStore(), PersistedUserPreferencesV1, savePersistedUserPreferences(), store

### Community 88 - "macos.rs"
Cohesion: 0.29
Nodes (3): open_settings(), Result, String

### Community 89 - "prepare_playable_path()"
Cohesion: 0.33
Nodes (6): prepare_playable_path(), AppHandle, Path, PathBuf, Result, String

### Community 90 - "macos.rs"
Cohesion: 0.43
Nodes (6): install_first_mouse_only_impl(), install_focus_restorer_impl(), install_main_panel_hit_test_impl(), post_did_move_notification_for_testing_impl(), AppHandle, WebviewWindow

### Community 91 - "PlayerCard.tsx"
Cohesion: 0.29
Nodes (4): PhaseKey, PHASES, PlayerCard(), PlayerCardProps

### Community 92 - "CC0 sound provenance workflow"
Cohesion: 0.38
Nodes (7): CC0 sound provenance workflow, Clear Success focus-end sound, Pomodoro end-sound candidates, Triple Ping break-end sound, Pure Pomodoro end-action resolver, PomodoroEndActionLayer, Top-popup playback fallback

### Community 93 - "Pencil Visual Source of Truth"
Cohesion: 0.29
Nodes (7): Mobile Companion App Design Implementation Plan, Mobile Companion App, Platform Widgets and Dynamic Island, Offline Archive And Window Layout Persistence Implementation Plan, Machine-Local Window Layout Persistence, Pencil Visual Source of Truth, Dedicated Settings Webview Window

### Community 94 - "Settings Panel Dedicated Window and Pixel Parity Design"
Cohesion: 0.38
Nodes (7): Settings Panel Dedicated Window and Pixel Parity Design, Point-to-Point Settings Event Bridge, Mirror Zustand Stores, Committed and Effective UI Scale, Five-Second Confirmation Timeout, DangerousChange State, Dangerous Global Settings Preview Confirm Persist Design

### Community 95 - "package.json"
Cohesion: 0.33
Nodes (5): description, name, private, type, version

### Community 98 - "inputCounterWindowConfig.test.ts"
Cohesion: 0.33
Nodes (5): activeAppRsPath, capabilitiesPath, here, libRsPath, tauriConfPath

### Community 99 - "stub.rs"
Cohesion: 0.53
Nodes (5): install_first_mouse_only_impl(), install_focus_restorer_impl(), install_main_panel_hit_test_impl(), AppHandle, WebviewWindow

### Community 100 - "Main Thread Window Construction"
Cohesion: 0.47
Nodes (6): Checked Main Thread Marker, Main Thread Window Construction, Settings Window Click Crash Fix Implementation Plan, Platform Native Window Move Observers, Post Drag Focus Restoration, Settings Focus Restore Implementation Plan

### Community 101 - "Shared Settings Apply Overlay"
Cohesion: 0.47
Nodes (6): Ordinary Apply Metadata Lifting, Settings Apply Overlay Implementation Plan, Shared Settings Apply Overlay, Content Area Scroll Ownership, Fixed Clipped Settings Shell, Settings Content Area Scroll Implementation Plan

### Community 102 - "Silent Signed Background Updates"
Cohesion: 0.47
Nodes (6): Manual Restart After Install, Silent Background Updates Implementation Plan, Silent Signed Background Updates, Autostart Setting Implementation Plan, OS Login Startup Reconciliation, Persisted Autostart Setting

### Community 103 - "manifest.json"
Cohesion: 0.40
Nodes (4): acquiredAt, license, notes, sounds

### Community 105 - "VideoPlayerApp.tsx"
Cohesion: 0.60
Nodes (3): closePlayerWindow(), close, VideoPlayerApp()

### Community 106 - "start.sh"
Cohesion: 0.70
Nodes (4): cleanup(), err(), log(), start.sh script

### Community 107 - "check-release-dependencies.sh"
Cohesion: 0.83
Nodes (3): check_cmd(), check_file(), check-release-dependencies.sh script

### Community 108 - "Alternating-tripod crawl cycle"
Cohesion: 0.50
Nodes (4): Alternating-tripod crawl cycle, American cockroach game asset, American cockroach asset prompts, Fixed 192×272 sprite pivot

### Community 109 - "open_settings()"
Cohesion: 0.50
Nodes (3): open_settings(), Result, String

### Community 110 - "open_settings()"
Cohesion: 0.50
Nodes (3): open_settings(), Result, String

### Community 111 - "Overlay Hit-Test Passthrough Design"
Cohesion: 0.83
Nodes (4): Overlay Hit-Test Passthrough Design, HitRegionStore, Native Hit-Test Passthrough, macOS and Windows Hit-Test Implementations

### Community 117 - "Settings Panel Drag and Pixel-Parity Implementation Plan"
Cohesion: 0.67
Nodes (3): Settings Panel Drag and Pixel-Parity Implementation Plan, Native settings-window dragging, Pencil settings-panel pixel parity

### Community 118 - "Windows Update Publish Implementation Plan"
Cohesion: 1.00
Nodes (3): Windows Update Publish Implementation Plan, GitHub Releases Updater, Windows x64 NSIS Release

## Knowledge Gaps
- **444 isolated node(s):** `metadata`, `STATE_LABELS`, `ClockProps`, `PanelKey`, `MENU_ITEMS` (+439 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `snapshot()` connect `UserDataStore.js` to `client.ts`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `AuthStore` connect `AuthStore.js` to `index.js`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `metadata`, `STATE_LABELS`, `ClockProps` to the rest of the system?**
  _444 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05165965404394577 - nodes in this community are weakly interconnected._
- **Should `mod.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.09800362976406533 - nodes in this community are weakly interconnected._
- **Should `presence.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07591836734693877 - nodes in this community are weakly interconnected._
- **Should `PomodoroEndActionLayer.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07493061979648474 - nodes in this community are weakly interconnected._