#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/../.." && pwd)"
control_center_root="$repository_root/control_center"
product_name="Anote Control Center"
pyinstaller_version="6.21.0"
build_root="$control_center_root/build/macos-packaging"
venv_root="$build_root/.venv"
dist_root="$control_center_root/dist"
app_path="$dist_root/$product_name.app"
dmg_path="$dist_root/Anote-Control-Center-macOS-Apple-Silicon.dmg"
dmg_root="$build_root/dmg-root"
runtime_compose="$control_center_root/src/anote_control_center/runtime/compose.yaml"

# Homebrew Python links pyexpat to Homebrew expat, while macOS strips DYLD
# variables before this script's system-shell entrypoint. Restore the
# architecture-standard library path inside the script for child interpreters.
if [[ -d /opt/homebrew/opt/expat/lib ]]; then
    export DYLD_LIBRARY_PATH="/opt/homebrew/opt/expat/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
fi

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
    echo "Anote Control Center macOS packages require an Apple Silicon Mac." >&2
    exit 1
fi

packaging_python="${CONTROL_CENTER_PACKAGING_PYTHON:-}"
if [[ -z "$packaging_python" ]]; then
    for candidate in python3.14 python3.13 python3.12 python3.11 python3; do
        if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys, tkinter; assert sys.version_info >= (3, 11) and tkinter.TkVersion >= 8.6' >/dev/null 2>&1; then
            packaging_python="$(command -v "$candidate")"
            break
        fi
    done
fi
if [[ -z "$packaging_python" || ! -x "$packaging_python" ]]; then
    echo "Packaging requires Python 3.11+ with Tk 8.6+." >&2
    exit 1
fi

package_version="$("$packaging_python" -c 'import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())["project"]["version"])' "$control_center_root/pyproject.toml")"
if [[ ! "$package_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Control Center version must be a three-part semantic version." >&2
    exit 1
fi

mkdir -p "$build_root" "$dist_root"
if [[ ! -x "$venv_root/bin/python" ]]; then
    "$packaging_python" -m venv "$venv_root"
fi
"$venv_root/bin/python" -m pip install --disable-pip-version-check "pyinstaller==$pyinstaller_version"
"$venv_root/bin/python" -c 'import tkinter; assert tkinter.TkVersion >= 8.6'
"$venv_root/bin/python" -m PyInstaller --noconfirm --clean --onedir --windowed \
    --name "$product_name" \
    --osx-bundle-identifier "com.anote.control-center" \
    --target-architecture arm64 \
    --distpath "$dist_root" \
    --workpath "$build_root/pyinstaller" \
    --specpath "$build_root/pyinstaller" \
    --paths "$control_center_root/src" \
    --add-data "$runtime_compose:anote_control_center/runtime" \
    "$control_center_root/src/anote_control_center/app.py"

executable="$app_path/Contents/MacOS/$product_name"
if [[ ! -x "$executable" ]]; then
    echo "The packaged Control Center executable is missing." >&2
    exit 1
fi
if find "$app_path" -type f \( -name '*.anote-release' -o -name '*.anote-checkpoint' -o -name '*.db' -o -name 'production.env' -o -name 'installation.json' -o -name 'journal.json' -o -name '*.tar' \) -print -quit | grep -q .; then
    echo "The payload-free app contains runtime or production material." >&2
    exit 1
fi

signing_identity="${APPLE_SIGNING_IDENTITY:-}"
require_signing="${REQUIRE_SIGNING:-0}"
if [[ "$require_signing" == "1" && -z "$signing_identity" ]]; then
    echo "Required macOS signing is not fully configured." >&2
    exit 1
fi
if [[ -n "$signing_identity" ]]; then
    /usr/bin/codesign --force --deep --options runtime --timestamp --sign "$signing_identity" "$app_path"
    /usr/bin/codesign --verify --deep --strict --verbose=2 "$app_path"
else
    echo "NOTICE: producing an unsigned macOS Control Center bundle." >&2
fi

"$executable" --self-check
rm -f "$dmg_path"
rm -rf "$dmg_root"
mkdir -p "$dmg_root"
/usr/bin/ditto "$app_path" "$dmg_root/$product_name.app"
ln -s /Applications "$dmg_root/Applications"
/usr/bin/hdiutil create -volname "$product_name" -srcfolder "$dmg_root" -format UDZO -ov "$dmg_path"

if [[ -n "$signing_identity" ]]; then
    /usr/bin/codesign --force --timestamp --sign "$signing_identity" "$dmg_path"
fi
notary_key="${APPLE_NOTARY_KEY_PATH:-}"
notary_key_id="${APPLE_NOTARY_KEY_ID:-}"
notary_issuer="${APPLE_NOTARY_ISSUER_ID:-}"
configured=0
[[ -n "$notary_key" ]] && configured=$((configured + 1))
[[ -n "$notary_key_id" ]] && configured=$((configured + 1))
[[ -n "$notary_issuer" ]] && configured=$((configured + 1))
if [[ "$configured" != "0" && "$configured" != "3" ]]; then
    echo "Apple notarization key, key ID, and issuer must be configured together." >&2
    exit 1
fi
if [[ "$require_signing" == "1" && "$configured" != "3" ]]; then
    echo "Required macOS notarization is not fully configured." >&2
    exit 1
fi
if [[ "$configured" == "3" ]]; then
    /usr/bin/xcrun notarytool submit "$dmg_path" --key "$notary_key" --key-id "$notary_key_id" --issuer "$notary_issuer" --wait
    /usr/bin/xcrun stapler staple "$dmg_path"
    /usr/bin/xcrun stapler validate "$dmg_path"
fi

printf '%s\n' "$dmg_path"
