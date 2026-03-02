#!/bin/bash
# vault-sync.sh — Sync .memory/ to Obsidian vault's Work Log folder.
#
# Opt-in: silently exits if WORK_LOG_PATH is not set.
#
# Usage:
#   scripts/vault-sync.sh [project-root]
#
# Environment:
#   WORK_LOG_PATH  — Path to Work Log folder in Obsidian vault
#                    (e.g., ~/Vault/60-Work-Log)
#
# The script mirrors <project-root>/.memory/ → $WORK_LOG_PATH/<project-name>/
# using rsync. Obsidian Sync picks up the changes automatically.

set -euo pipefail

# ── Opt-in check ───────────────────────────────────────────────────

VAULT_DIR="${WORK_LOG_PATH:-}"
[ -z "$VAULT_DIR" ] && exit 0  # not configured, skip silently

# ── Resolve project root and name ─────────────────────────────────

PROJECT_ROOT="${1:-$PWD}"
MEMORY_DIR="$PROJECT_ROOT/.memory"

if [ ! -d "$MEMORY_DIR" ]; then
  echo "[vault-sync] No .memory/ directory at $PROJECT_ROOT — skipping"
  exit 0
fi

# Use git repo name as project folder name
PROJECT_NAME=$(basename "$(cd "$PROJECT_ROOT" && git rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT_ROOT")")
TARGET="$VAULT_DIR/$PROJECT_NAME"

# ── Ensure target structure exists ─────────────────────────────────

mkdir -p "$TARGET"

# Ensure _global/ type directories exist
for dir in architecture domain-facts api-contracts glossary lessons-learned; do
  mkdir -p "$VAULT_DIR/_global/$dir"
done

# ── Sync ───────────────────────────────────────────────────────────

rsync -av --delete \
  --exclude='config.yaml' \
  --exclude='locks/' \
  --exclude='raw/' \
  --exclude='.obsidian*' \
  --exclude='index.json' \
  "$MEMORY_DIR/" "$TARGET/"

echo "[vault-sync] Synced $MEMORY_DIR → $TARGET"
