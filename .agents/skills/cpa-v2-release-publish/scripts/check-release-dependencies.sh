#!/usr/bin/env bash
set -euo pipefail

CONFIG="${CPA_V2_RELEASE_SECRET_CONFIG:-$HOME/.config/cpa-v2-release/release-secret-paths.env}"

if [[ ! -f "$CONFIG" ]]; then
  echo "missing config: $CONFIG"
  exit 2
fi

# shellcheck disable=SC1090
source "$CONFIG"

check_file() {
  local label="$1"
  local path="${2:-}"
  if [[ -z "$path" ]]; then
    printf '%-34s %s\n' "$label" "UNSET"
    return 1
  fi
  if [[ -f "$path" ]]; then
    local mode
    mode="$(stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path" 2>/dev/null || echo '?')"
    printf '%-34s %s mode=%s\n' "$label" "OK" "$mode"
  else
    printf '%-34s missing: %s\n' "$label" "$path"
    return 1
  fi
}

check_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '%-34s %s\n' "$cmd" "$(command -v "$cmd")"
  else
    printf '%-34s missing\n' "$cmd"
    return 1
  fi
}

echo "config=$CONFIG"
echo "repo=${CPA_V2_REPO:-UNSET}"
echo "github_repo=${GITHUB_REPO:-UNSET}"
echo "release_endpoint=${CPA_UPDATER_ENDPOINT:-UNSET}"
echo

failed=0
check_file "updater private key" "${CPA_UPDATER_PRIVATE_KEY_PATH:-}" || failed=1
check_file "updater password file" "${CPA_UPDATER_PASSWORD_PATH:-}" || failed=1
check_file "updater public key" "${CPA_UPDATER_PUBLIC_KEY_PATH:-}" || failed=1
check_file "github ssh key" "${GITHUB_SSH_KEY_PATH:-}" || failed=1
check_file "legacy nanzhai ssh key" "${REMOTE_NANZHAI_SSH_KEY_PATH:-}" || true
echo

check_cmd git || failed=1
check_cmd gh || failed=1
check_cmd npm || failed=1
if [[ -n "${RUST_TOOLCHAIN_BIN:-}" && -x "$RUST_TOOLCHAIN_BIN/cargo" ]]; then
  printf '%-34s %s\n' "cargo" "$RUST_TOOLCHAIN_BIN/cargo"
elif command -v cargo >/dev/null 2>&1; then
  printf '%-34s %s\n' "cargo" "$(command -v cargo)"
else
  printf '%-34s missing\n' "cargo"
  failed=1
fi
check_cmd codesign || true
check_cmd hdiutil || true
echo

if command -v gh >/dev/null 2>&1; then
  gh auth status || failed=1
fi

if [[ -n "${GITHUB_SSH_KEY_PATH:-}" && -f "${GITHUB_SSH_KEY_PATH:-}" ]]; then
  echo
  ssh-keygen -y -f "$GITHUB_SSH_KEY_PATH" >/tmp/cpa-v2-release-github-key.pub 2>/dev/null || true
  if [[ -s /tmp/cpa-v2-release-github-key.pub ]]; then
    echo "github ssh public fingerprint:"
    ssh-keygen -lf /tmp/cpa-v2-release-github-key.pub
  fi
  rm -f /tmp/cpa-v2-release-github-key.pub
fi

exit "$failed"
