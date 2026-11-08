#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="realwarp/FLUX"
MINIMUM_BUN="1.4.4"
OS_NAME="$(uname -s)"
MACHINE="$(uname -m)"

case "$OS_NAME" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  *) printf 'FLUX installer does not support this operating system: %s\n' "$OS_NAME" >&2; exit 1 ;;
esac
case "$MACHINE" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) printf 'FLUX installer does not support this architecture: %s\n' "$MACHINE" >&2; exit 1 ;;
esac

if ! command -v bun >/dev/null 2>&1 || ! bun -e \
  'const [major, minor, patch] = (await Bun.version).split(".").map(Number); process.exit(major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch >= 4))) ? 0 : 1)' \
  >/dev/null 2>&1; then
  printf 'FLUX requires Bun %s or newer. Install it with the official installer? [y/N] ' "$MINIMUM_BUN"
  if [ ! -r /dev/tty ] || ! read -r consent </dev/tty; then
    printf 'A terminal is required to confirm Bun installation. Install Bun %s and rerun this installer.\n' "$MINIMUM_BUN" >&2
    exit 1
  fi
  case "$consent" in
    y|Y|yes|YES) curl -fsSL https://bun.sh/install | bash ;;
    *) printf 'Installation cancelled. Install Bun %s or newer, then rerun this installer.\n' "$MINIMUM_BUN" >&2; exit 1 ;;
  esac
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1 || ! bun -e \
    'const [major, minor, patch] = (await Bun.version).split(".").map(Number); process.exit(major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch >= 4))) ? 0 : 1)' \
    >/dev/null 2>&1; then
    printf 'Bun installation did not provide Bun %s or newer.\n' "$MINIMUM_BUN" >&2
    exit 1
  fi
fi

RELEASE_TAG="$(bun -e 'const requested = process.env.FLUX_VERSION; const valid = !requested || /^v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(requested); if (!valid) throw new Error("FLUX_VERSION must be a release tag such as v0.1.0 or v0.1.0-rc.1."); const url = requested ? `https://api.github.com/repos/realwarp/FLUX/releases/tags/${encodeURIComponent(requested)}` : "https://api.github.com/repos/realwarp/FLUX/releases/latest"; const response = await fetch(url); if (!response.ok) throw new Error(`Could not find release ${requested ?? "latest"} (${response.status}).`); console.log((await response.json()).tag_name)')"
if ! [[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]]; then
  printf 'GitHub returned an invalid FLUX release tag.\n' >&2
  exit 1
fi
if [ -n "${FLUX_VERSION:-}" ] && [ "$RELEASE_TAG" != "$FLUX_VERSION" ]; then
  printf 'GitHub returned %s instead of requested version %s.\n' "$RELEASE_TAG" "$FLUX_VERSION" >&2
  exit 1
fi
ASSET="flux-${RELEASE_TAG}-${PLATFORM}-${ARCH}.tar.gz"
RELEASE_URL="https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}"
DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/flux"
BIN_ROOT="$HOME/.local/bin"
VERSION_ROOT="$DATA_ROOT/versions"
TEMP_ROOT="$(mktemp -d)"
STAGE="$VERSION_ROOT/stage-$$"
cleanup() {
  rm -rf -- "$TEMP_ROOT"
  if [ -d "$STAGE" ]; then rm -rf -- "$STAGE"; fi
}
trap cleanup EXIT

mkdir -p "$VERSION_ROOT" "$BIN_ROOT"
curl -fsSL "$RELEASE_URL/$ASSET" -o "$TEMP_ROOT/$ASSET"
curl -fsSL "$RELEASE_URL/SHA256SUMS.txt" -o "$TEMP_ROOT/SHA256SUMS.txt"
EXPECTED="$(awk -v name="$ASSET" '$2 == name { print $1; exit }' "$TEMP_ROOT/SHA256SUMS.txt")"
if [ -z "$EXPECTED" ]; then
  printf 'The release checksum file does not list %s.\n' "$ASSET" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TEMP_ROOT/$ASSET" | awk '{ print $1 }')"
else
  ACTUAL="$(shasum -a 256 "$TEMP_ROOT/$ASSET" | awk '{ print $1 }')"
fi
if [ "$ACTUAL" != "$EXPECTED" ]; then
  printf 'SHA-256 verification failed. FLUX was not installed.\n' >&2
  exit 1
fi

mkdir -p "$STAGE"
tar -xzf "$TEMP_ROOT/$ASSET" -C "$STAGE"
(
  cd "$STAGE"
  bun install --production --frozen-lockfile --ignore-scripts
)
VERSION="${RELEASE_TAG#v}-${ACTUAL:0:8}"
DESTINATION="$VERSION_ROOT/$VERSION"
if [ -d "$DESTINATION" ]; then
  rm -rf -- "$STAGE"
else
  mv -- "$STAGE" "$DESTINATION"
fi
printf '%s\n' "$VERSION" > "$DATA_ROOT/current.tmp"
mv -f -- "$DATA_ROOT/current.tmp" "$DATA_ROOT/current"

cat > "$BIN_ROOT/flux" <<'LAUNCHER'
#!/usr/bin/env sh
set -eu
DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/flux"
VERSION="$(cat "$DATA_ROOT/current")"
exec bun run "$DATA_ROOT/versions/$VERSION/dist/src/cli.js" "$@"
LAUNCHER
chmod 755 "$BIN_ROOT/flux"

case "${SHELL##*/}" in
  fish)
    PROFILE="$HOME/.config/fish/config.fish"
    PATH_LINE='fish_add_path "$HOME/.local/bin"'
    mkdir -p "$(dirname "$PROFILE")"
    touch "$PROFILE"
    if ! grep -Fqx "$PATH_LINE" "$PROFILE"; then printf '\n%s\n' "$PATH_LINE" >> "$PROFILE"; fi
    ;;
  zsh)
    for PROFILE in "$HOME/.zprofile" "$HOME/.zshrc"; do
      touch "$PROFILE"
      if ! grep -Fqx 'export PATH="$HOME/.local/bin:$PATH"' "$PROFILE"; then
        printf '\n%s\n' 'export PATH="$HOME/.local/bin:$PATH"' >> "$PROFILE"
      fi
    done
    ;;
  bash)
    for PROFILE in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile"; do
      touch "$PROFILE"
      if ! grep -Fqx 'export PATH="$HOME/.local/bin:$PATH"' "$PROFILE"; then
        printf '\n%s\n' 'export PATH="$HOME/.local/bin:$PATH"' >> "$PROFILE"
      fi
    done
    ;;
  *)
    PROFILE="$HOME/.profile"
    touch "$PROFILE"
    if ! grep -Fqx 'export PATH="$HOME/.local/bin:$PATH"' "$PROFILE"; then
      printf '\n%s\n' 'export PATH="$HOME/.local/bin:$PATH"' >> "$PROFILE"
    fi
    ;;
esac
export PATH="$BIN_ROOT:$PATH"

printf 'FLUX %s installed. Open a new terminal, run `flux`, and choose a model.\n' "$RELEASE_TAG"
printf 'To uninstall the application, remove `%s` and `%s`. Configuration and sessions are kept separately.\n' "$DATA_ROOT" "$BIN_ROOT/flux"
