#!/bin/sh
# Install repo-tracked git hooks into the active git dir.
#
# Works for the main checkout AND for `git worktree` checkouts — we install
# into `$(git rev-parse --git-common-dir)/hooks/`, which is the shared hooks
# directory that worktrees inherit by default.

set -e

ROOT="$(git rev-parse --show-toplevel)"
COMMON_DIR="$(git rev-parse --git-common-dir)"
HOOKS_SRC="$ROOT/scripts/hooks"
HOOKS_DST="$COMMON_DIR/hooks"

if [ ! -d "$HOOKS_SRC" ]; then
  echo "install-hooks: no scripts/hooks/ directory at $HOOKS_SRC" >&2
  exit 1
fi

mkdir -p "$HOOKS_DST"

for src in "$HOOKS_SRC"/*; do
  name="$(basename "$src")"
  # Don't install this installer itself, or non-executable helpers.
  case "$name" in
    install.sh|README*|*.md) continue ;;
  esac
  dst="$HOOKS_DST/$name"
  cp "$src" "$dst"
  chmod +x "$dst"
  echo "install-hooks: installed $name -> $dst"
done

echo "install-hooks: done. Use 'git commit --no-verify' to skip the hook."
