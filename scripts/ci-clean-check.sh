#!/usr/bin/env bash
# CI guard: fail if build artifacts leaked into the working tree.
# Run after build steps to catch dist/ or generated .js files.
set -euo pipefail

dirty=$(git diff --name-only 2>/dev/null || true)
untracked=$(git ls-files --others --exclude-standard 2>/dev/null || true)

all="$dirty"$'\n'"$untracked"

offenders=$(echo "$all" | grep -E '(^|/)dist/|\.js$' | grep -v 'scripts/' | grep -v '.config.' || true)

if [ -n "$offenders" ]; then
  echo "ERROR: build artifacts detected in working tree:"
  echo "$offenders"
  exit 1
fi

echo "Clean-check passed: no build artifacts detected."
