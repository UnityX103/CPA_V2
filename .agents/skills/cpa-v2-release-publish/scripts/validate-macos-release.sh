#!/usr/bin/env bash
set -euo pipefail

manifest="${1:-}"
asset_dir="${2:-}"
x64_app="${3:-}"
arm_app="${4:-}"

if [[ -z "$manifest" || ! -f "$manifest" ]]; then
  echo "usage: validate-macos-release.sh <latest.json> [asset-directory] [x64-app] [arm-app]" >&2
  exit 2
fi

validate_thin_app() {
  local app_path="$1"
  local expected_arch="$2"
  local mach_o_count=0

  if [[ ! -d "$app_path" ]]; then
    echo "app bundle not found: $app_path" >&2
    return 1
  fi

  while IFS= read -r -d '' candidate; do
    local file_kind
    file_kind="$(file -b "$candidate" 2>/dev/null || true)"
    if [[ "$file_kind" == Mach-O* ]]; then
      local architectures
      architectures="$(lipo -archs "$candidate")"
      if [[ "$architectures" != "$expected_arch" ]]; then
        echo "invalid Mach-O architecture: $candidate expected=$expected_arch actual=$architectures" >&2
        return 1
      fi
      mach_o_count=$((mach_o_count + 1))
    fi
  done < <(find "$app_path" -type f -print0)

  if [[ "$mach_o_count" -eq 0 ]]; then
    echo "no Mach-O files found in app bundle: $app_path" >&2
    return 1
  fi
}

if ! command -v jq >/dev/null 2>&1; then
  echo "missing command: jq" >&2
  exit 2
fi

if ! jq -e '
  ((.version // "") | type == "string" and length > 0)
  and ((.platforms["darwin-x86_64"].url // "") | endswith("/app.tar.gz"))
  and ((.platforms["darwin-x86_64"].signature // "") | type == "string" and length > 0)
  and ((.platforms["darwin-aarch64"].url // "") | endswith("/app-aarch64.tar.gz"))
  and ((.platforms["darwin-aarch64"].signature // "") | type == "string" and length > 0)
' "$manifest" >/dev/null; then
  echo "invalid macOS updater manifest: both darwin-x86_64 and darwin-aarch64 are required" >&2
  exit 1
fi

version="$(jq -r '.version' "$manifest")"

if [[ -n "$asset_dir" ]]; then
  if [[ ! -d "$asset_dir" ]]; then
    echo "asset directory not found: $asset_dir" >&2
    exit 2
  fi

  required_assets=(
    "app.tar.gz"
    "app.tar.gz.sig"
    "app-aarch64.tar.gz"
    "app-aarch64.tar.gz.sig"
    "CPA_V2_${version}_x64.dmg"
    "CPA_V2_${version}_arm64.dmg"
  )

  for asset in "${required_assets[@]}"; do
    if [[ ! -s "$asset_dir/$asset" ]]; then
      echo "missing or empty release asset: $asset_dir/$asset" >&2
      exit 1
    fi
  done
fi

if [[ -n "$x64_app" || -n "$arm_app" ]]; then
  if [[ -z "$x64_app" || -z "$arm_app" ]]; then
    echo "both x64-app and arm-app are required for architecture validation" >&2
    exit 2
  fi
  if ! command -v file >/dev/null 2>&1 || ! command -v lipo >/dev/null 2>&1; then
    echo "missing command: file and lipo are required for architecture validation" >&2
    exit 2
  fi
  validate_thin_app "$x64_app" "x86_64"
  validate_thin_app "$arm_app" "arm64"
fi

echo "macOS release gate passed: version=$version platforms=darwin-x86_64,darwin-aarch64"
