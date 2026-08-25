# Parallels Windows x64 Release Build

Use this reference only when the Windows updater package will be built in an existing Parallels VM.

## VM ownership and cleanup

1. Discover VMs with `prlctl list -a`; do not invent a VM name.
2. Record whether the selected VM was already running.
3. If it was stopped, start it with `prlctl start <name>` and wait until `prlctl exec <name> cmd.exe /c ver` succeeds.
4. Put VM shutdown in a finally-style cleanup path. For a VM started by this workflow, run `prlctl exec <name> shutdown.exe /s /t 0`, poll until its state is `stopped`, and only use `prlctl stop <name>` as a bounded fallback when graceful shutdown does not finish.
5. If the VM was already running, leave it running unless the user explicitly authorized closing it.

Run cleanup after success, build failure, upload failure, or validation failure. Never leave a workflow-started VM running merely because the release stopped early.

## Command execution context

`prlctl exec` may run as Windows SYSTEM rather than the interactive user. Set the intended Windows profile before Git, Rust, or Node commands:

```bat
set HOME=C:\Users\<user>
set USERPROFILE=C:\Users\<user>
set PATH=C:\Users\<user>\.cargo\bin;C:\Program Files\nodejs;%PATH%
```

Use the VM's existing repository if it is clean, fast-forward it to the exact release commit, and verify the resulting HEAD before building. Do not copy an uncommitted host worktree into the VM.

## Apple Silicon host: Windows ARM64 to Windows x64

Parallels on Apple Silicon normally runs Windows ARM64, but CPA_V2 publishes Windows x86_64 NSIS only. Installing the x86_64 Rust *target* on the ARM64 toolchain is insufficient because Cargo build scripts still compile for ARM64 and can be linked against the wrong CRT.

Use all three of these together:

1. Install/select the full `stable-x86_64-pc-windows-msvc` Rust toolchain.
2. Initialize Visual Studio with `vcvarsarm64_amd64.bat` so x64 MSVC tools and libraries are active.
3. Build explicitly with `--target x86_64-pc-windows-msvc --bundles nsis`.

For example, the environment driving Tauri should contain:

```powershell
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
npm.cmd run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis
```

Verify the built application, not only the NSIS bootstrap executable: the release `app.exe` must be `PE32+ ... x86-64`. NSIS itself may use a 32-bit self-extracting stub while correctly packaging an x64 application.

## Signing credentials and artifact transfer

- Keep updater keys only in ignored credential paths. A Parallels shared folder may expose the host's ignored `cpa-v2-release/` pack to the VM.
- Load the private key and password into `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` without printing either value.
- Do not copy GitHub tokens or SSH private keys into the VM when the host will publish the finished assets.
- Generate `windows-x86_64-nsis` and `windows-x86_64` entries in the VM, then copy the `.exe`, `.sig`, and Windows manifest back to an ignored host staging directory.
- On the host, merge Windows platform entries with both macOS entries. Upload binary/signature assets first and `latest.json` last.

Before publishing, confirm the final manifest version matches all artifacts and contains complete entries for `darwin-x86_64`, `darwin-aarch64`, `windows-x86_64-nsis`, and `windows-x86_64`.
