# Graph Report - CPA_V2  (2026-09-05)

## Corpus Check
- 366 files · ~471,768 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3368 nodes · 6648 edges · 206 communities (180 shown, 26 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 67 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `116d4221`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.js
- accessibility/mod.rs
- presence.ts
- pomodoroEndAction.ts
- lib.rs
- prepare-updater-release.mjs
- window_helpers/mod.rs
- presence_detection/mod.rs
- tauri.conf.json
- RoomManager.js
- permissions
- audio.rs
- ui/SettingsPanel.tsx
- settings.ts
- UserDataStore.js
- presence_detection/windows.rs
- network.ts
- appUpdate.ts
- compilerOptions
- devDependencies
- scaled_window.rs
- Active App Multiplayer Payload
- bindingKey.ts
- client.ts
- ui/PomodoroPanel.tsx
- host.ts
- App.tsx
- extension_packs.rs
- NativeError
- cockroach_module.rs
- video_editor_module.rs
- pomodoroBroadcast.ts
- compilerOptions
- window_layout.rs
- AuthStore.js
- pomodoro.ts
- 摄像头工位在场自动控制设计
- OnlineSettingsPanel.tsx
- remotePlayerWindows.ts
- dependencies
- devDependencies
- pipeline.py
- key_counter.rs
- app.js
- GlobalSettingsPanel.tsx
- launch_game.sh
- sync-cnb-release.mjs
- sound_files.rs
- video_files.rs
- video_files/macos.rs
- Open-source animal video matting research
- Server/package.json
- DeskWindow.tsx
- Settings state and dispatch bridge
- CPA_V2 Release Publish
- cockroach-electron-module/scripts/package_layers.py
- updateConfig.test.ts
- CPA_V2 Tauri rewrite architecture
- Mirrored Check-in Windows
- CheckinPlanTemplate
- VideoEditorModuleContractTests
- presence_detection/stub.rs
- page.tsx
- Mobile Companion App Design
- updater.json
- extensionPacks.ts
- windowPinConfig.test.ts
- components/PomodoroPanel.tsx
- Pomodoro End Action
- pomodoroSounds.ts
- CPA Video Editor Module
- windowLayoutConfig.test.ts
- compilerOptions
- Presence Observation
- macOS Accessibility permission gate
- Fixed Size Pomodoro Main Host
- checkinEnabled
- CPA_V2 Adversarial Review
- scripts
- components/InputCounterPanel.tsx
- PomodoroSettingsPanel.tsx
- Account Cloud Snapshot
- CPA to Tauri 2 and Rust Rewrite Design
- CPA_V2 Game Launcher
- cameraPermissionConfig.test.ts
- DevAlignApp.tsx
- Pomodoro Cloud Settings Design
- SAM 2.1 + BiRefNet-matting 第四方案：跨平台与商用审计
- accessibility/macos.rs
- prepare_playable_path
- window_helpers/macos.rs
- components/PlayerCard.tsx
- CC0 sound provenance workflow
- Pencil Visual Source of Truth
- Settings Panel Dedicated Window and Pixel Parity Design
- app/package.json
- appExitConfig.test.ts
- 2. 修复方案
- inputCounterWindowConfig.test.ts
- window_helpers/stub.rs
- Main Thread Window Construction
- Shared Settings Apply Overlay
- Silent Signed Background Updates
- manifest.json
- font.test.ts
- 设置窗口点击立崩 (macOS) — 修复设计
- start.sh
- check-release-dependencies.sh
- Local-First Settings Sync Design
- open_settings
- open_settings
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
- runtime.ts
- @vitejs/plugin-react
- @vitest/coverage-v8
- Tauri React TypeScript app template
- next-env.d.ts
- postcss.config.mjs
- CockroachModulePanel.tsx
- Mouse Input Counter Design
- Account Login Design
- Autostart Setting Design
- key_counter 监听健康检查与自恢复设计
- Account Login Room Gate Design
- Pomodoro Main Window Fit-Panel Design
- 临时聚焦窗口设计
- 专注结束后自动置顶设计
- useExtensionPackStore
- Remote Player Card Follow-Up Design
- Check-in Editor Inherit and Context Menu Design
- video-editor-module/scripts/package_module.py
- Silent Background Updates Design
- Daily Check-in Panels Design
- Check-in Editor Panel Drag Design
- Check-in Editor Pixel Sync and Icon Editing Design
- Check-in Item Repeat Plan Design
- Remote Player Sync And Card Parity Design
- Offline Archive And Window Layout Persistence Design
- build_runtime.py
- Settings Apply Overlay Design
- Check-in Global Toggle Design
- video-editor-module/scripts/package_layers.py
- cockroach_module/macos.rs
- unsupported.rs
- cockroach_module/windows.rs
- Scaled Window Sizing
- Account Auth Status Reset Design
- 专注结束后自动置顶设计
- TODO Panel Design
- 设置面板空白区域拖拽 — 修复设计
- Check-in System Lifecycle Design
- CPA V2 extension contract
- Settings Plan Panel And Pet Removal Design
- Settings Content Area Scroll Design
- ContractTest
- Input Counter Panel Regression Fix Design
- DzDyI Count/Cycle Pixel Sync Design
- VZN4U Count Fields Audit Design
- Downloadable AI video editor module
- protocol.js
- Active App Logo And Title Display Design
- main.tsx
- video-editor-module/scripts/build_layered_index.py
- cockroach-electron-module/scripts/build_layered_index.py
- prepare
- LayeredContractTest
- Layered cockroach module release
- Layered video editor module release
- accept_runtime
- consume_logic_root
- videoEditorModuleConfig.test.ts
- cockroach-electron-module/licenses/NONCOMMERCIAL-NOTICE.md
- IconCache
- BUILD_MATRIX.md
- video-editor-module/licenses/THIRD-PARTY-SOURCES.md
- replace_file_atomically
- replace_file_atomically
- replace_file_atomically
- PomodoroEndActionLayer.tsx
- extensionPackConfig.test.ts
- extensions/README.md
- audioPlayback.ts
- pomodoroVideoWindow.ts
- soundFiles.ts
- createPomodoroServer
- ExtensionSettingsOutlet.tsx
- PresenceAvailability
- jsdom
- RoomManagerError

## God Nodes (most connected - your core abstractions)
1. `NativeError` - 41 edges
2. `useSettingsStore` - 31 edges
3. `App()` - 28 edges
4. `CockroachModuleState` - 26 edges
5. `download_layered_module()` - 23 edges
6. `BridgeSnapshot` - 23 edges
7. `VideoEditorModuleContractTests` - 23 edges
8. `download_layered_module()` - 22 edges
9. `usePomodoroStore` - 22 edges
10. `摄像头工位在场自动控制设计` - 22 edges

## Surprising Connections (you probably didn't know these)
- `normalizeDataFile()` --indirect_call--> `snapshot()`  [INFERRED]
  Server/src/UserDataStore.js → app/src/domain/bridge/client.test.ts
- `write_core_pointer()` --calls--> `replace_file_atomically()`  [INFERRED]
  app/src-tauri/src/cockroach_module.rs → app/src-tauri/src/extension_packs.rs
- `launch_cockroach_module()` --calls--> `pack_is_enabled()`  [INFERRED]
  app/src-tauri/src/cockroach_module.rs → app/src-tauri/src/extension_packs.rs
- `download_video_editor_file()` --calls--> `replace_file_atomically()`  [INFERRED]
  app/src-tauri/src/video_editor_module.rs → app/src-tauri/src/extension_packs.rs
- `write_core_pointer()` --calls--> `replace_file_atomically()`  [INFERRED]
  app/src-tauri/src/video_editor_module.rs → app/src-tauri/src/extension_packs.rs

## Import Cycles
- 3-file cycle: `app/src/domain/appUpdate.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/appUpdate.ts`
- 3-file cycle: `app/src/domain/bindingKey.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/bindingKey.ts`
- 3-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/network.ts -> app/src/domain/bridge/dispatch.ts`
- 3-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/pomodoro.ts -> app/src/domain/bridge/dispatch.ts`
- 3-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/presence.ts -> app/src/domain/bridge/dispatch.ts`
- 3-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/settings.ts -> app/src/domain/bridge/dispatch.ts`
- 4-file cycle: `app/src/domain/appUpdate.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/appUpdate.ts`
- 4-file cycle: `app/src/domain/bindingKey.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/bindingKey.ts`
- 4-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/network.ts -> app/src/domain/bridge/dispatch.ts`
- 4-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/pomodoro.ts -> app/src/domain/bridge/dispatch.ts`
- 4-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/settings.ts -> app/src/domain/bridge/dispatch.ts`
- 4-file cycle: `app/src/domain/appUpdate.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/appUpdate.ts`
- 4-file cycle: `app/src/domain/bindingKey.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/bindingKey.ts`
- 4-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/presence.ts -> app/src/domain/pomodoro.ts -> app/src/domain/bridge/dispatch.ts`
- 5-file cycle: `app/src/domain/appUpdate.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/appUpdate.ts`
- 5-file cycle: `app/src/domain/bindingKey.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/bindingKey.ts`
- 5-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/network.ts -> app/src/domain/bridge/dispatch.ts`
- 5-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/pomodoro.ts -> app/src/domain/bridge/dispatch.ts`
- 5-file cycle: `app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/cloudAccountData.ts -> app/src/domain/userPreferences.ts -> app/src/domain/settings.ts -> app/src/domain/bridge/dispatch.ts`
- 5-file cycle: `app/src/domain/audioPlayback.ts -> app/src/domain/settings.ts -> app/src/domain/bridge/dispatch.ts -> app/src/domain/bridge/protocol.ts -> app/src/domain/pomodoroSounds.ts -> app/src/domain/audioPlayback.ts`

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

## Communities (206 total, 26 thin omitted)

### Community 0 - "index.js"
Cohesion: 0.16
Nodes (31): broadcastToRoom(), DEFAULT_PORT, ensureAuthenticated(), ensureConnectionNotInRoom(), handleAuthCreate(), handleAuthLogin(), handleAuthLogout(), handleAuthSession() (+23 more)

### Community 1 - "accessibility/mod.rs"
Cohesion: 0.10
Nodes (43): AccessibilityStatus, accessibility_status(), AccessibilityChangedPayload, AccessibilityStatus, app_bundle_root(), bundle_identifier(), code_sign_identifier(), current_status() (+35 more)

### Community 2 - "presence.ts"
Cohesion: 0.07
Nodes (42): presenceAutomationContextSignature(), applyLivePresenceSample(), applyPresenceCapability(), applyPresenceSample(), capabilityState(), createPresenceStore(), defaultMonitorRuntime, initialPresenceState() (+34 more)

### Community 3 - "pomodoroEndAction.ts"
Cohesion: 0.19
Nodes (12): basename(), MaybePromise, PomodoroEndActionRuntime, PomodoroEndActionState, resolvePomodoroEndAction(), BUILTIN_POMODORO_VIDEOS, BuiltinPomodoroVideo, DEFAULT_BUILTIN_POMODORO_VIDEO_ID (+4 more)

### Community 4 - "lib.rs"
Cohesion: 0.11
Nodes (48): ActiveAppInfo, ActiveAppInfo, AppWindowBounds, current_active_app(), current_active_app_front_window(), current_active_app_icon_data_url(), current_active_app_window_bounds(), current_active_app_window_title() (+40 more)

### Community 5 - "prepare-updater-release.mjs"
Cohesion: 0.10
Nodes (34): artifactMatchesVersion(), artifactUrl(), assertFreshSignature(), assertVersion(), copyIfExists(), DEFAULT_APP_ROOT, execFileAsync, githubAssetName() (+26 more)

### Community 6 - "window_helpers/mod.rs"
Cohesion: 0.09
Nodes (28): install_first_mouse_only(), install_focus_restorer(), install_main_panel_hit_test(), main_panel_corner_radius(), main_panel_hit_test_scales_with_the_window(), point_in_rounded_rect(), post_did_move_notification_for_testing(), AppHandle (+20 more)

### Community 7 - "presence_detection/mod.rs"
Cohesion: 0.08
Nodes (59): camera_presence_status(), CameraDevice, error_sample(), exit_cancellation_terminates_helper_promptly(), finish_stream_reader(), helper_payload_round_trips_success_and_structured_errors(), list_camera_devices(), NativeErrorKind (+51 more)

### Community 8 - "tauri.conf.json"
Cohesion: 0.05
Nodes (36): app, macOSPrivateApi, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl (+28 more)

### Community 9 - "RoomManager.js"
Cohesion: 0.10
Nodes (21): clampString(), cloneRemoteState(), defaultRoomCodeFactory, EMPTY_ROOM_TTL_MS, getPriorityFingerprint(), MAX_PLAYER_NAME_LENGTH, MAX_PLAYER_STATE_UPDATES_PER_WINDOW, MAX_PLAYERS_PER_ROOM (+13 more)

### Community 10 - "permissions"
Cohesion: 0.06
Nodes (33): description, identifier, main, permissions, $schema, windows, autostart:allow-disable, autostart:allow-enable (+25 more)

### Community 11 - "audio.rs"
Cohesion: 0.12
Nodes (31): ActivePlayback, AudioOutputDevice, AudioPlaybackResult, AudioPlaybackState, AudioReader, builtin_sound_bytes(), list_audio_output_devices(), normalize_volume() (+23 more)

### Community 12 - "ui/SettingsPanel.tsx"
Cohesion: 0.08
Nodes (23): CameraDevice, listCameraDevices(), invoke, accountErrorText(), AppUpdateSettingsRow(), appUpdateStatusText(), cloudSyncStatusText(), confirmedPresenceText() (+15 more)

### Community 13 - "settings.ts"
Cohesion: 0.08
Nodes (37): applyAutostartEnabled(), readAutostartEnabled(), plugin, { listenMock, invokeMock }, ConfirmedDispatchOptions, createDispatchRequestId(), dispatch(), dispatchConfirmed() (+29 more)

### Community 14 - "UserDataStore.js"
Cohesion: 0.12
Nodes (21): snapshot(), clampNumber(), clampString(), cloneSnapshot(), DEFAULT_FILE_PATH, normalizeAppUpdate(), normalizeBindingInput(), normalizeBindingKey() (+13 more)

### Community 15 - "presence_detection/windows.rs"
Cohesion: 0.13
Nodes (30): availability_for_error(), classify_camera_error(), create_face_detector(), generic_camera_errors_keep_their_safe_pipeline_stage(), list_devices(), map_camera_error_at(), open_camera(), open_privacy_settings() (+22 more)

### Community 16 - "network.ts"
Cohesion: 0.05
Nodes (38): clearPersistedAccountSession(), isPersistedAccountSessionV1(), loadPersistedAccountSession(), openStore(), PersistedAccountSession, PersistedAccountSessionV1, savePersistedAccountSession(), store (+30 more)

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
Cohesion: 0.06
Nodes (46): ActiveAppState, useActiveAppStore, AccessibilityStatus, applyHealth(), BindingInput, BindingKeyActions, BindingKeyPlatform, BindingKeyState (+38 more)

### Community 23 - "client.ts"
Cohesion: 0.10
Nodes (29): applySnapshotToMirrors(), cloneActiveAppForMirror(), cloneDangerousChange(), cloneEntries(), clonePlayer(), clonePlayers(), hasIconDataProperty(), sameActiveAppIdentity() (+21 more)

### Community 24 - "ui/PomodoroPanel.tsx"
Cohesion: 0.14
Nodes (9): formatMmSs(), usePresenceStore, ClockRingProps, ClockState, clockStateOf(), phaseLabel(), PomodoroPanel(), { startDragging, invokeMock } (+1 more)

### Community 25 - "host.ts"
Cohesion: 0.09
Nodes (44): ActiveAppInfo, AppUpdateSnapshot, BindingKeyEntry, activeAppIdentitySig(), activeAppSig(), applyDispatch(), appUpdateSig(), appUpdateSnapshot() (+36 more)

### Community 26 - "App.tsx"
Cohesion: 0.11
Nodes (33): App(), buildStartupSettingsSnapshot(), clampStartupScale(), getStartupSettingsState(), StartupArchiveSource, mocks, userPreferenceStores(), waitForAccountRestoreAttempt() (+25 more)

### Community 27 - "extension_packs.rs"
Cohesion: 0.21
Nodes (34): dependent_id(), emit_statuses(), extension_pack_statuses(), ExtensionPackPreferences, ExtensionPackStatus, ExtensionPackStatusChanged, ExtensionRuntimeContribution, install_extension_pack() (+26 more)

### Community 28 - "NativeError"
Cohesion: 0.17
Nodes (27): availability_for_error(), camera_index(), classify_camera_error(), detect_face(), list_devices(), map_camera_error(), open_camera(), open_privacy_settings() (+19 more)

### Community 29 - "cockroach_module.rs"
Cohesion: 0.07
Nodes (127): accepts_noncommercial_layered_runtime_and_logic_index(), accepts_the_base64_wrapped_signature_emitted_by_tauri_signer(), accepts_the_expected_module_contract(), activate_layered_installation(), child_is_running(), cockroach_module_status(), CockroachModuleSettings, CockroachModuleState (+119 more)

### Community 30 - "video_editor_module.rs"
Cohesion: 0.07
Nodes (122): accepts_the_base64_wrapped_signature_emitted_by_tauri_signer(), accepts_the_expected_module_contract(), activate_layered_installation(), begin_module_update(), bundled_tool_path(), child_is_running(), common_pack_state(), ComponentFile (+114 more)

### Community 31 - "pomodoroBroadcast.ts"
Cohesion: 0.14
Nodes (18): PomodoroPhase, PomodoroStore, createPomodoroBroadcast(), eventTypeFor(), POMODORO_BROADCAST_EVENT, POMODORO_BROADCAST_SNAPSHOT_REQUEST_EVENT, POMODORO_BROADCAST_VERSION, PomodoroBroadcast (+10 more)

### Community 32 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+14 more)

### Community 33 - "window_layout.rs"
Cohesion: 0.23
Nodes (19): apply_layout(), empty_snapshot(), install_tracking(), is_supported_window_label(), load_layout(), normalize_layout(), read_snapshot(), AppHandle (+11 more)

### Community 34 - "AuthStore.js"
Cohesion: 0.19
Nodes (11): AuthStore, AuthStoreError, createSession(), createSessionToken(), DEFAULT_FILE_PATH, hashPassword(), normalizeAccountInput(), normalizeDataFile() (+3 more)

### Community 35 - "pomodoro.ts"
Cohesion: 0.09
Nodes (43): AppUpdateStore, BindingKeyStore, cloneBindingKey(), cloneBindingKeyEntry(), CloudStores, mergeCloudAccountDataConflict(), NetworkStore, PomodoroStore (+35 more)

### Community 36 - "摄像头工位在场自动控制设计"
Cohesion: 0.04
Nodes (45): Bridge 与 UI 测试, D-01：已确认决策, macOS, Rust 与平台测试, Windows, 专注中离场, 休息中在场暂停、离席恢复, 关闭 (+37 more)

### Community 37 - "OnlineSettingsPanel.tsx"
Cohesion: 0.10
Nodes (7): DEFAULT_HISTORY, DEFAULT_ROOM, OnlinePhase, OnlineSettingsPanelProps, PHASE_LABEL, RoomHistory, RoomMember

### Community 38 - "remotePlayerWindows.ts"
Cohesion: 0.08
Nodes (30): isRemotePlayerCardPosition(), loadRemotePlayerCardPositions(), normalizePositions(), openStore(), PersistedRemotePlayerCardPositionsV1, RemotePlayerCardPosition, RemotePlayerCardPositions, saveQueue (+22 more)

### Community 39 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, react, react-dom, @tauri-apps/api, @tauri-apps/plugin-autostart, @tauri-apps/plugin-dialog, @tauri-apps/plugin-process, @tauri-apps/plugin-store (+11 more)

### Community 40 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, @tauri-apps/cli, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react, @types/react-dom, typescript (+11 more)

### Community 41 - "pipeline.py"
Cohesion: 0.12
Nodes (33): Progress, Downloadable CPA video-editor module., bounded_float(), bounded_int(), _choose_seed_frame(), _decode_frames(), _encode_macos_preview(), _encode_webm() (+25 more)

### Community 42 - "key_counter.rs"
Cohesion: 0.15
Nodes (10): InputPressedPayload, Arc, AtomicBool, Option, Result, Self, String, spawn_listener() (+2 more)

### Community 43 - "app.js"
Cohesion: 0.06
Nodes (34): api(), applyResolutionPreset(), applySourceDefaults(), DEFAULT_MATTING_PARAMETERS, downloadOutput, downloadPreview, endInput, errorPanel (+26 more)

### Community 44 - "GlobalSettingsPanel.tsx"
Cohesion: 0.12
Nodes (3): BindingKey, DEFAULT_BINDINGS, GlobalSettingsPanelProps

### Community 45 - "launch_game.sh"
Cohesion: 0.32
Nodes (13): ensure_dirs(), ensure_npm(), is_pid_running(), is_port_open(), launch_game.sh script, start(), start_server(), start_tauri() (+5 more)

### Community 46 - "sync-cnb-release.mjs"
Cohesion: 0.15
Nodes (26): assertSafeRepo(), assertSafeTag(), assetNameFromUrl(), cnbLatestAssetUrl(), cnbTaggedAssetUrl(), DEFAULT_CNB_REPO, prepareCnbRelease(), releaseTagFromUrl() (+18 more)

### Community 47 - "sound_files.rs"
Cohesion: 0.27
Nodes (12): allow_sound_asset_file(), CustomSoundValidation, invalid(), prepare_custom_sound_path(), AppHandle, Option, Path, R (+4 more)

### Community 48 - "video_files.rs"
Cohesion: 0.27
Nodes (12): allow_video_asset_file(), CustomVideoValidation, invalid(), prepare_custom_alpha_video_path(), AppHandle, Option, Path, R (+4 more)

### Community 49 - "video_files/macos.rs"
Cohesion: 0.25
Nodes (15): alpha_cache_filename(), alpha_tmp_path(), alpha_transcode_supports_vp9_and_vp8_sources(), cached_alpha_video_is_fresh(), ffmpeg_alpha_transcode_arguments(), prepare_playable_path(), AppHandle, OsString (+7 more)

### Community 50 - "Open-source animal video matting research"
Cohesion: 0.14
Nodes (14): BiRefNet matting, Cutie, Open-source animal video matting research, GFM and AM-2K, HEVC with Alpha MOV, Publishable animal video matting pipeline, RGBA PNG frame-sequence master, SAM 2.1 (+6 more)

### Community 51 - "Server/package.json"
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

### Community 55 - "cockroach-electron-module/scripts/package_layers.py"
Cohesion: 0.19
Nodes (30): component_document(), copy_dependencies(), copy_logic_source(), dependency_inventory(), discover_production_dependencies(), main(), package_dependencies(), package_logic() (+22 more)

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

### Community 60 - "VideoEditorModuleContractTests"
Cohesion: 0.11
Nodes (5): load_build_runtime(), load_layer_packager(), load_packager(), load_pipeline(), VideoEditorModuleContractTests

### Community 61 - "presence_detection/stub.rs"
Cohesion: 0.20
Nodes (14): list_devices(), open_privacy_settings(), request_access(), CameraDevice, Duration, FnMut, Option, PresenceAvailability (+6 more)

### Community 62 - "page.tsx"
Cohesion: 0.20
Nodes (6): GlobalSettingsPanel(), OnlineSettingsPanel(), SettingsPanel(), SettingsPanelProps, SettingsTab, TABS

### Community 63 - "Mobile Companion App Design"
Cohesion: 0.07
Nodes (26): Android 2x2 Widget, Android 4x2 Widget, Android Widgets, Chosen Direction, Compact State, Dynamic Island, Error And Empty States, Expanded State (+18 more)

### Community 64 - "updater.json"
Cohesion: 0.20
Nodes (9): description, identifier, main, permissions, $schema, windows, process:allow-restart, updater:allow-check (+1 more)

### Community 65 - "extensionPacks.ts"
Cohesion: 0.12
Nodes (22): createExtensionPackStore(), emptyRevisions(), emptyStatus(), emptyStatuses(), errorText(), ExtensionPackDescriptor, ExtensionPackKind, extensionPackRegistry (+14 more)

### Community 66 - "windowPinConfig.test.ts"
Cohesion: 0.20
Nodes (4): accessibilityRsPath, here, libRsPath, tauriConfPath

### Community 67 - "components/PomodoroPanel.tsx"
Cohesion: 0.24
Nodes (6): Clock(), ClockProps, ClockState, STATE_LABELS, PomodoroPanel(), PomodoroPanelProps

### Community 68 - "Pomodoro End Action"
Cohesion: 0.27
Nodes (10): Check-in Window Pin Policy, Temporary Focus Windows Implementation Plan, Temporary Focus Command, Main Window Pin Design, Main-Window-Only Pin Command, No Default Always-On-Top, Bundled Qianqian Video, Custom WebM Validation and Popup Fallback (+2 more)

### Community 69 - "pomodoroSounds.ts"
Cohesion: 0.15
Nodes (20): playSound(), SoundSource, BREAK_END_SOUNDS, BuiltinPomodoroSound, builtinSoundForSelection(), DEFAULT_POMODORO_END_SOUNDS, defaultPlaybackDeps, FOCUS_END_SOUNDS (+12 more)

### Community 70 - "CPA Video Editor Module"
Cohesion: 0.08
Nodes (20): Third-party sources, Cockroach Electron module, Package layered components, Prepare the reviewed source, Upstream settings and lifecycle, CPA_V2, 使用的开源项目, 应用与服务端基础设施 (+12 more)

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
Cohesion: 0.20
Nodes (10): scripts, build, dev, preview, release:cnb:prepare, release:cnb:sync, release:updater, tauri (+2 more)

### Community 79 - "components/InputCounterPanel.tsx"
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

### Community 85 - "DevAlignApp.tsx"
Cohesion: 0.24
Nodes (8): DevAlignApp(), initialMode(), initialTargetId(), MOCK_PLAYER, Mode, PaneProps, Target, TARGETS

### Community 86 - "Pomodoro Cloud Settings Design"
Cohesion: 0.08
Nodes (23): Alternative: Room-Owned Settings, Alternative: Server Only For Pomodoro Durations, Approaches Considered, Client Architecture, Conflict Handling, Current Context, Data Flow, Field Behavior (+15 more)

### Community 87 - "SAM 2.1 + BiRefNet-matting 第四方案：跨平台与商用审计"
Cohesion: 0.09
Nodes (21): 2.1 核心组件, 2.2 BiRefNet-matting 的训练数据风险, 2.3 与真正的非商用候选区分, 5.1 Meta 官方支持边界, 5.2 目标平台判断, 6.1 VP8 Alpha WebM → Windows, 6.2 HEVC with Alpha → macOS, 6.3 当前样片证据 (+13 more)

### Community 88 - "accessibility/macos.rs"
Cohesion: 0.29
Nodes (3): open_settings(), Result, String

### Community 89 - "prepare_playable_path"
Cohesion: 0.33
Nodes (6): prepare_playable_path(), AppHandle, Path, PathBuf, Result, String

### Community 90 - "window_helpers/macos.rs"
Cohesion: 0.43
Nodes (6): install_first_mouse_only_impl(), install_focus_restorer_impl(), install_main_panel_hit_test_impl(), post_did_move_notification_for_testing_impl(), AppHandle, WebviewWindow

### Community 91 - "components/PlayerCard.tsx"
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

### Community 95 - "app/package.json"
Cohesion: 0.33
Nodes (5): description, name, private, type, version

### Community 97 - "2. 修复方案"
Cohesion: 0.10
Nodes (20): 1.1 复现路径, 1.2 根因, 1. 故障与根因, 2.1 新增模块 `passthrough::install_focus_restorer`, 2.2 macOS 实现 (`passthrough/macos.rs`), 2.3 Windows 实现 (`passthrough/windows.rs`), 2.4 Stub (`passthrough/stub.rs`), 2.5 `lib.rs::setup` 接线 (+12 more)

### Community 98 - "inputCounterWindowConfig.test.ts"
Cohesion: 0.33
Nodes (5): activeAppRsPath, capabilitiesPath, here, libRsPath, tauriConfPath

### Community 99 - "window_helpers/stub.rs"
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

### Community 105 - "设置窗口点击立崩 (macOS) — 修复设计"
Cohesion: 0.10
Nodes (19): 1.1 用户可见症状, 1.2 崩溃报告关键栈, 1.3 根因, 1. 故障与根因, 2.1 主线程主权边界, 2.2 `app/src-tauri/src/lib.rs` 改动, 2.3 `app/src-tauri/src/passthrough/{macos,windows}.rs` 改动, 2.4 不改动 (+11 more)

### Community 106 - "start.sh"
Cohesion: 0.70
Nodes (4): cleanup(), err(), log(), start.sh script

### Community 107 - "check-release-dependencies.sh"
Cohesion: 0.83
Nodes (3): check_cmd(), check_file(), check-release-dependencies.sh script

### Community 108 - "Local-First Settings Sync Design"
Cohesion: 0.10
Nodes (19): Alternative: Add A Separate Persistence File Per Store, Alternative: Cloud Snapshot Only With Local Cache After Login, Approaches Considered, Client Data Flow, Cloud Data Expansion, Conflict Handling, Current Context, Durable Settings (+11 more)

### Community 109 - "open_settings"
Cohesion: 0.50
Nodes (3): open_settings(), Result, String

### Community 110 - "open_settings"
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

### Community 121 - "runtime.ts"
Cohesion: 0.15
Nodes (13): extensionPackCatalog, ExtensionPackId, ExtensionPackProgress, ExtensionRuntimeContribution, EventDrivenRuntimeAdapter, ActiveRuntimeEntry, ExtensionRuntimeModule, RUNTIME_LOADERS (+5 more)

### Community 134 - "CockroachModulePanel.tsx"
Cohesion: 0.31
Nodes (10): CockroachModuleSettings, CockroachModuleStatus, killAllCockroaches(), launchCockroachModule(), readCockroachModuleStatus(), saveCockroachModuleSettings(), CockroachModulePanel(), DEFAULT_SETTINGS (+2 more)

### Community 135 - "Mouse Input Counter Design"
Cohesion: 0.11
Nodes (17): Alternative: fake mouse key codes, Alternative: separate mouse counter feature, Approaches Considered, Bridge and remote sync, Context, Design, Domain model, Error handling (+9 more)

### Community 136 - "Account Login Design"
Cohesion: 0.11
Nodes (17): Account Login Design, Approaches Considered, Client Architecture, Current Context, Data Flow, Default Product Decisions, Error Handling, Goal (+9 more)

### Community 137 - "Autostart Setting Design"
Cohesion: 0.12
Nodes (16): Approaches Considered, Autostart Integration, Autostart Setting Design, Bridge, Error Handling, Frontend State, Goal, Native Commands Per Platform (+8 more)

### Community 138 - "key_counter 监听健康检查与自恢复设计"
Cohesion: 0.12
Nodes (16): key_counter 监听健康检查与自恢复设计, Rust 侧, 前端, 启动, 实施顺序, 应用恢复前台, 数据流, 权限翻转 (+8 more)

### Community 139 - "Account Login Room Gate Design"
Cohesion: 0.12
Nodes (16): Account Login Room Gate Design, Alternative: Make The Server Auto-Create Guest Accounts, Alternative: Split Auth Into A Dedicated Store, Approaches Considered, Client Account Lifecycle, Current Context, Goal, Non-Goals (+8 more)

### Community 140 - "Pomodoro Main Window Fit-Panel Design"
Cohesion: 0.12
Nodes (15): 1. Problem, 2. Goals, 3. Non-Goals, 4. Architecture, 5. Components and File-Level Changes, 6. Data Flow, 7. Error Handling, 8. Testing (+7 more)

### Community 141 - "临时聚焦窗口设计"
Cohesion: 0.12
Nodes (15): Pencil 设计, 临时聚焦窗口设计, 临时聚焦行为, 今日打卡窗口, 备选方案 A：继续复用 `isPinned`, 备选方案 B：只显示前端浮层, 推荐方案：新增“临时聚焦”命令，移除自动置顶设置, 方案选择 (+7 more)

### Community 142 - "专注结束后自动置顶设计"
Cohesion: 0.12
Nodes (15): App 事件流, Bridge 与镜像窗口, Native 与平台限制, 与结束提示的关系, 专注结束后自动置顶设计, 后续实现边界, 当前上下文, 方案选择 (+7 more)

### Community 143 - "useExtensionPackStore"
Cohesion: 0.29
Nodes (8): useExtensionPackStore, launchVideoEditorModule(), readVideoEditorModuleStatus(), invoke, VideoEditorModuleStatus, errorText(), invoke, VideoEditorModuleTab()

### Community 144 - "Remote Player Card Follow-Up Design"
Cohesion: 0.13
Nodes (14): Approaches Considered, Bridge And Window Timing, Card Geometry, Context, Design, Error Handling, Goal, Non-Goals (+6 more)

### Community 145 - "Check-in Editor Inherit and Context Menu Design"
Cohesion: 0.13
Nodes (14): Adding items cancels inheritance, Approval Notes, Check-in Editor Inherit and Context Menu Design, Data Flow, Error Handling, Goal, Inherit empty state, Interaction Design (+6 more)

### Community 146 - "video-editor-module/scripts/package_module.py"
Cohesion: 0.35
Nodes (14): DistributionPolicy, entry_path(), main(), normalize_configuration(), normalize_package_name(), Path, require_exact_fields(), required_python_packages() (+6 more)

### Community 147 - "Silent Background Updates Design"
Cohesion: 0.14
Nodes (13): Architecture, Confirmed Product Decisions, Error Handling, Goal, Out Of Scope, References, Release Packaging, Runtime Flow (+5 more)

### Community 148 - "Daily Check-in Panels Design"
Cohesion: 0.14
Nodes (13): Analysis Panel Summary, Context, Daily Check-in Panels Design, Data Model, Error Handling, Goals, Non-Goals, Pixel-Sync Requirements (+5 more)

### Community 149 - "Check-in Editor Panel Drag Design"
Cohesion: 0.14
Nodes (13): Alternatives Considered, Check-in Editor Panel Drag Design, Context, CSS App Region, Dedicated Header Drag, Error Handling, Goals, Interaction Rules (+5 more)

### Community 150 - "Check-in Editor Pixel Sync and Icon Editing Design"
Cohesion: 0.14
Nodes (13): Check-in Editor Pixel Sync and Icon Editing Design, Context, Data Model, Editor Behavior, Error Handling, Goals, Non-Goals, Pencil Design Changes (+5 more)

### Community 151 - "Check-in Item Repeat Plan Design"
Cohesion: 0.14
Nodes (13): Bridge And Cloud Sync, Check-in Item Repeat Plan Design, Context, Day Semantics, Editor Behavior, Error Handling, Goals, Non-Goals (+5 more)

### Community 152 - "Remote Player Sync And Card Parity Design"
Cohesion: 0.15
Nodes (12): Architecture, Current Context, Drag And Positioning, Goals, Non-Goals, Problem, Protocol, Remote Card Display (+4 more)

### Community 153 - "Offline Archive And Window Layout Persistence Design"
Cohesion: 0.15
Nodes (12): Architecture, Change Data Flow, Current Context, Durable Archive Data, Error Handling, Goal, Manual Verification, Offline Archive And Window Layout Persistence Design (+4 more)

### Community 154 - "build_runtime.py"
Cohesion: 0.36
Nodes (10): clean_source_commit(), digest(), download(), interpreter_target(), main(), prepare_models(), Path, run() (+2 more)

### Community 155 - "Settings Apply Overlay Design"
Cohesion: 0.17
Nodes (11): Component Design, Context, CSS And Layout, Goals, Implementation Constraints, Non-Goals, Pencil Design, Settings Apply Overlay Design (+3 more)

### Community 156 - "Check-in Global Toggle Design"
Cohesion: 0.17
Nodes (11): Check-in Global Toggle Design, Context, Data Flow, Error Handling, Goals, Non-Goals, Pencil Requirements, Product Behavior (+3 more)

### Community 157 - "video-editor-module/scripts/package_layers.py"
Cohesion: 0.52
Nodes (11): inspect_ffmpeg(), main(), package_engine(), package_logic(), package_models(), Path, validate_distribution(), validate_logic_license_pack() (+3 more)

### Community 158 - "cockroach_module/macos.rs"
Cohesion: 0.33
Nodes (9): configure_child_command(), ensure_entry_executable(), restore_archive_permissions(), restore_archive_symlink(), Command, Option, Path, Result (+1 more)

### Community 159 - "unsupported.rs"
Cohesion: 0.33
Nodes (9): configure_child_command(), ensure_entry_executable(), restore_archive_permissions(), restore_archive_symlink(), Command, Option, Path, Result (+1 more)

### Community 160 - "cockroach_module/windows.rs"
Cohesion: 0.33
Nodes (9): configure_child_command(), ensure_entry_executable(), restore_archive_permissions(), restore_archive_symlink(), Command, Option, Path, Result (+1 more)

### Community 161 - "Scaled Window Sizing"
Cohesion: 0.18
Nodes (10): Architecture, Context, Data Flow, Error Handling, Goals, Non-Goals, Scaled Window Sizing, Size And Bounds Rules (+2 more)

### Community 162 - "Account Auth Status Reset Design"
Cohesion: 0.18
Nodes (10): Account Auth Status Reset Design, Alternative: Add A Separate Room Busy Flag, Alternative: Only Hide The Overlay In UI, Approaches Considered, Current Context, Goal, Non-Goals, Recommended: Reset Connection Status After Auth-Only Results (+2 more)

### Community 163 - "专注结束后自动置顶设计"
Cohesion: 0.18
Nodes (10): Bridge 与 Settings UI, Pencil 设计, Pomodoro Pin 行为, 专注结束后自动置顶设计, 方案选择, 测试计划, 状态与持久化, 目标 (+2 more)

### Community 164 - "TODO Panel Design"
Cohesion: 0.18
Nodes (10): Architecture, Behavior, Components, Goal, Non-Goals, Pencil Source, Self-Review, Settings (+2 more)

### Community 165 - "设置面板空白区域拖拽 — 修复设计"
Cohesion: 0.20
Nodes (9): 1. 问题, 2. 方案选择, 3. 交互边界, 4. 组件设计, 5. 数据流, 6. 错误处理, 7. 测试, 8. 自检 (+1 more)

### Community 166 - "Check-in System Lifecycle Design"
Cohesion: 0.20
Nodes (9): Check-in System Lifecycle Design, Context, Data Flow, Goals, Non-Goals, Recommended Approach, Self-Review, Testing (+1 more)

### Community 167 - "CPA V2 extension contract"
Cohesion: 0.07
Nodes (26): Canonical code seams, CPA V2 extension contract, Disable, Install or upgrade, Lifecycle commands, Ownership model, Runtime contribution manifest, Security and release boundaries (+18 more)

### Community 168 - "Settings Plan Panel And Pet Removal Design"
Cohesion: 0.22
Nodes (8): Behavior, Context, Data Flow, Default Decisions, Settings Plan Panel And Pet Removal Design, Spec Self-Review, Testing, UI Mapping

### Community 169 - "Settings Content Area Scroll Design"
Cohesion: 0.25
Nodes (7): Context, Design, Goals, Implementation Notes, Non-Goals, Settings Content Area Scroll Design, Testing

### Community 171 - "Input Counter Panel Regression Fix Design"
Cohesion: 0.29
Nodes (6): Design, Input Counter Panel Regression Fix Design, Out Of Scope, Problem, Root Cause Direction, Testing

### Community 172 - "DzDyI Count/Cycle Pixel Sync Design"
Cohesion: 0.29
Nodes (6): Context, Design, DzDyI Count/Cycle Pixel Sync Design, Goal, Out Of Scope, Testing

### Community 173 - "VZN4U Count Fields Audit Design"
Cohesion: 0.29
Nodes (6): Context, Design, Goal, Out Of Scope, Testing, VZN4U Count Fields Audit Design

### Community 174 - "Downloadable AI video editor module"
Cohesion: 0.29
Nodes (6): Downloadable AI video editor module, Goal, Historical baseline, Package boundary, Pipeline, Release gate

### Community 175 - "protocol.js"
Cohesion: 0.16
Nodes (24): clampString(), createPlayerJoinedMessage(), createRoomSnapshotMessage(), encodeMessage(), normalizeAccountCredentials(), normalizeActiveApp(), normalizeAuthToken(), normalizeBindingKey() (+16 more)

### Community 176 - "Active App Logo And Title Display Design"
Cohesion: 0.33
Nodes (5): Active App Logo And Title Display Design, Design, Out Of Scope, Problem, Testing

### Community 177 - "main.tsx"
Cohesion: 0.33
Nodes (6): useExtensionPackSync(), which, WindowRoot(), closePlayerWindow(), close, VideoPlayerApp()

### Community 178 - "video-editor-module/scripts/build_layered_index.py"
Cohesion: 0.60
Nodes (5): main(), package_entry(), Path, validate_component_document(), validate_version()

### Community 179 - "cockroach-electron-module/scripts/build_layered_index.py"
Cohesion: 0.70
Nodes (4): build_index(), main(), package_entry(), validate_component()

### Community 180 - "prepare"
Cohesion: 0.60
Nodes (4): main(), prepare(), Path, replace_once()

### Community 182 - "Layered cockroach module release"
Cohesion: 0.50
Nodes (3): Build, Layered cockroach module release, Publish and cache rules

### Community 183 - "Layered video editor module release"
Cohesion: 0.50
Nodes (3): Build and package changed components, Build and sign the index, Layered video editor module release

### Community 184 - "accept_runtime"
Cohesion: 0.67
Nodes (3): accept_runtime(), main(), Path

### Community 185 - "consume_logic_root"
Cohesion: 0.67
Nodes (3): consume_logic_root(), main(), Path

### Community 192 - "replace_file_atomically"
Cohesion: 0.50
Nodes (4): replace_file_atomically(), Path, Result, String

### Community 193 - "replace_file_atomically"
Cohesion: 0.50
Nodes (4): replace_file_atomically(), Path, Result, String

### Community 194 - "replace_file_atomically"
Cohesion: 0.50
Nodes (4): replace_file_atomically(), Path, Result, String

### Community 195 - "PomodoroEndActionLayer.tsx"
Cohesion: 0.15
Nodes (17): FocusableAppWindowLabel, focusAppWindow(), { invokeMock }, PomodoroEndEvent, playPomodoroEndSound(), openPomodoroVideoWindow(), customVideoSrc(), pickCustomWebmPath() (+9 more)

### Community 198 - "audioPlayback.ts"
Cohesion: 0.33
Nodes (5): AudioOutputDevice, AudioPlaybackResult, listAudioOutputDevices(), invoke, AudioSettingsCard()

### Community 199 - "pomodoroVideoWindow.ts"
Cohesion: 0.29
Nodes (4): PomodoroEndActionResolution, PomodoroVideoWindowAction, mocks, VideoScreenRect

### Community 200 - "soundFiles.ts"
Cohesion: 0.48
Nodes (5): customSoundSrc(), pickCustomMp3Path(), showCustomSoundMissingMessage(), mocks, validateCustomSoundPath()

### Community 201 - "createPomodoroServer"
Cohesion: 0.11
Nodes (13): clearConnectionInitTimeout(), createPomodoroServer(), handleKnownError(), installProcessGuards(), waitForListening(), createErrorMessage(), normalizeErrorCode(), authClient() (+5 more)

### Community 202 - "ExtensionSettingsOutlet.tsx"
Cohesion: 0.40
Nodes (4): ExtensionSettingsRenderer, ExtensionSettingsOutlet(), SETTINGS_RENDERERS, PetSettingsTab()

### Community 203 - "PresenceAvailability"
Cohesion: 0.47
Nodes (4): PresenceAvailability, PresenceAuthorizationAction, presenceAuthorizationView, PresenceAuthorizationControl()

## Knowledge Gaps
- **1008 isolated node(s):** `metadata`, `STATE_LABELS`, `ClockProps`, `PanelKey`, `MENU_ITEMS` (+1003 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `snapshot()` connect `UserDataStore.js` to `client.ts`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `metadata`, `STATE_LABELS`, `ClockProps` to the rest of the system?**
  _1008 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `accessibility/mod.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.09800362976406533 - nodes in this community are weakly interconnected._
- **Should `presence.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07239819004524888 - nodes in this community are weakly interconnected._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.11085972850678733 - nodes in this community are weakly interconnected._
- **Should `prepare-updater-release.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10384068278805121 - nodes in this community are weakly interconnected._
- **Should `window_helpers/mod.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.08558558558558559 - nodes in this community are weakly interconnected._