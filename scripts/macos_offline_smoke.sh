#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-src-tauri/target/universal-apple-darwin/release/bundle/macos/HomeLedger.app}"
if [[ ! -d "$app_path" ]]; then
  echo "Missing macOS app bundle: $app_path" >&2
  exit 1
fi

executable="$app_path/Contents/MacOS/HomeLedger"
if [[ ! -x "$executable" ]]; then
  echo "Missing executable in app bundle: $executable" >&2
  exit 1
fi

isolated_home="$(mktemp -d "${TMPDIR:-/tmp}/homeledger-smoke.XXXXXX")"
log_path="$isolated_home/app.log"
pid=""
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$isolated_home"
}
trap cleanup EXIT

HOME="$isolated_home" "$executable" >"$log_path" 2>&1 &
pid=$!
database_path="$isolated_home/Library/Application Support/com.homeledger.app/home-ledger.sqlite3"

for _ in {1..45}; do
  if [[ -f "$database_path" ]]; then
    echo "HomeLedger created a local SQLite database at $database_path"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    cat "$log_path" >&2
    echo "HomeLedger exited before creating its local database" >&2
    exit 1
  fi
  sleep 1
done

cat "$log_path" >&2
echo "Timed out waiting for HomeLedger local database initialization" >&2
exit 1
