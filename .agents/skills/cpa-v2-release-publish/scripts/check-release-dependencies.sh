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

failed=0
expected_cnb_repo="nanzhaigame-xpy/CPA_V2"
expected_primary_endpoint="https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/latest.json"
expected_fallback_endpoint="https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json"

echo "config=$CONFIG"
echo "repo=${CPA_V2_REPO:-UNSET}"
echo "github_repo=${GITHUB_REPO:-UNSET}"
echo "cnb_repo=${CNB_REPO:-UNSET}"
echo "release_endpoint=${CPA_UPDATER_ENDPOINT:-UNSET}"
echo "fallback_endpoint=${CPA_UPDATER_FALLBACK_ENDPOINT:-UNSET}"
echo

if [[ "${CNB_REPO:-}" != "$expected_cnb_repo" ]]; then
  printf '%-34s expected=%s actual=%s\n' "cnb repo config" "$expected_cnb_repo" "${CNB_REPO:-UNSET}"
  failed=1
fi
if [[ "${CPA_UPDATER_ENDPOINT:-}" != "$expected_primary_endpoint" ]]; then
  printf '%-34s expected CNB primary\n' "updater endpoint config"
  failed=1
fi
if [[ "${CPA_UPDATER_FALLBACK_ENDPOINT:-}" != "$expected_fallback_endpoint" ]]; then
  printf '%-34s expected GitHub fallback\n' "updater fallback config"
  failed=1
fi

check_file "updater private key" "${CPA_UPDATER_PRIVATE_KEY_PATH:-}" || failed=1
check_file "updater password file" "${CPA_UPDATER_PASSWORD_PATH:-}" || failed=1
check_file "updater public key" "${CPA_UPDATER_PUBLIC_KEY_PATH:-}" || failed=1
check_file "github ssh key" "${GITHUB_SSH_KEY_PATH:-}" || failed=1
check_file "CNB release token" "${CNB_TOKEN_FILE:-}" || failed=1
if [[ -z "${CNB_TOKEN:-}" ]]; then
  printf '%-34s %s\n' "CNB_TOKEN loaded" "EMPTY"
  failed=1
else
  printf '%-34s %s\n' "CNB_TOKEN loaded" "OK"
fi
check_file "legacy nanzhai ssh key" "${REMOTE_NANZHAI_SSH_KEY_PATH:-}" || true
echo

check_cmd git || failed=1
check_cmd gh || failed=1
check_cmd cnb || failed=1
check_cmd npm || failed=1
check_cmd curl || failed=1
check_cmd jq || failed=1
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
check_cmd lipo || true
echo

if [[ "$(uname -s)" == "Darwin" ]]; then
  if command -v rustup >/dev/null 2>&1; then
    printf '%-34s %s\n' "rustup" "$(command -v rustup)"
    installed_targets="$(rustup target list --installed)"
    for target in x86_64-apple-darwin aarch64-apple-darwin; do
      if grep -qx "$target" <<<"$installed_targets"; then
        printf '%-34s %s\n' "rust target $target" "OK"
      else
        printf '%-34s %s\n' "rust target $target" "missing"
        failed=1
      fi
    done
  else
    printf '%-34s %s\n' "rustup" "missing"
    failed=1
  fi
  echo
fi

if command -v gh >/dev/null 2>&1; then
  gh auth status || failed=1
fi

if command -v cnb >/dev/null 2>&1; then
  cnb status || failed=1
  if [[ -n "${CNB_REPO:-}" ]]; then
    cnb_status="$(cnb repositories get-by-id --repo "$CNB_REPO" --verbose 2>/dev/null | jq -r '.status // 0' || echo 0)"
    if [[ "$cnb_status" == "200" ]]; then
      printf '%-34s %s\n' "cnb repository access" "OK"
    else
      printf '%-34s status=%s\n' "cnb repository access" "$cnb_status"
      failed=1
    fi
  fi
fi

if [[ -n "${CPA_V2_REPO:-}" && -d "${CPA_V2_REPO:-}/.git" ]]; then
  cnb_remote="$(git -C "$CPA_V2_REPO" remote get-url cnb 2>/dev/null || true)"
  expected_cnb_remote="https://cnb.cool/${CNB_REPO:-$expected_cnb_repo}.git"
  if [[ "$cnb_remote" == "$expected_cnb_remote" ]]; then
    printf '%-34s %s\n' "cnb git remote" "OK"
  else
    printf '%-34s expected=%s actual=%s\n' "cnb git remote" "$expected_cnb_remote" "${cnb_remote:-MISSING}"
    failed=1
  fi
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
