#!/usr/bin/env bash
set -euo pipefail

# Dalinar — Full workspace setup
# Initializes submodules, dependencies, memory pack, skills, hooks, and agent configs.
# Idempotent — safe to re-run at any time.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPT_DIR"

CLAUDE_GLOBAL="${HOME}/.claude"
CLAUDE_PROJECT="${SCRIPT_DIR}/.claude"
OPENCODE_DIR="${SCRIPT_DIR}/.opencode"
SKILLS_DIR="${SCRIPT_DIR}/skills"
JASNAH_DIR="${SCRIPT_DIR}/modules/jasnah"
SAZED_DIR="${SCRIPT_DIR}/modules/sazed"
HOID_DIR="${SCRIPT_DIR}/modules/hoid"
HOID_SKILLS_DIR="${HOID_DIR}/packages/skills"
MEMORY_DIR="${SCRIPT_DIR}/.memory"

# All Hoid skills to link into the project
HOID_ALL_SKILLS=(adversarial-review gsap-react image-to-webp k8s-audit meditate refine ruminate sanity-tools)

# All skills that should be available globally (all project skills)
GLOBAL_SKILLS_LIST=(
  calendar dialectic jira reducing-entropy using-git-worktrees
  jasnah-debug-trace jasnah-query jasnah-search-memory jasnah-export-memory
  "${HOID_ALL_SKILLS[@]}"
)

# Global skill directories for each agent platform
CLAUDE_SKILLS_DIR="${CLAUDE_GLOBAL}/skills"
OPENCODE_SKILLS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills"
CODEX_SKILLS_DIR="${HOME}/.agents/skills"

ok()   { echo "  [ok] $1"; }
skip() { echo "  [skip] $1 (already exists)"; }
info() { echo ""; echo "==> $1"; }
warn() { echo "  [warn] $1"; }

run_with_optional_sudo() {
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

install_ripgrep() {
  if command -v rg >/dev/null 2>&1; then
    skip "ripgrep (rg)"
    return
  fi

  echo "  ripgrep (rg) not found; attempting installation..."

  if command -v brew >/dev/null 2>&1; then
    brew install ripgrep || warn "brew install ripgrep failed"
  elif command -v apt-get >/dev/null 2>&1; then
    run_with_optional_sudo apt-get update -qq && run_with_optional_sudo apt-get install -y -qq ripgrep || warn "apt-get install ripgrep failed"
  elif command -v dnf >/dev/null 2>&1; then
    run_with_optional_sudo dnf install -y -q ripgrep || warn "dnf install ripgrep failed"
  elif command -v yum >/dev/null 2>&1; then
    run_with_optional_sudo yum install -y -q ripgrep || warn "yum install ripgrep failed"
  elif command -v pacman >/dev/null 2>&1; then
    run_with_optional_sudo pacman -S --noconfirm ripgrep || warn "pacman install ripgrep failed"
  elif command -v apk >/dev/null 2>&1; then
    run_with_optional_sudo apk add ripgrep || warn "apk add ripgrep failed"
  else
    warn "No supported package manager found to install ripgrep automatically"
  fi

  if command -v rg >/dev/null 2>&1; then
    ok "ripgrep (rg) installed"
  else
    warn "ripgrep (rg) still unavailable; install manually to enable fast search"
  fi
}

symlink_or_replace() {
  local src="$1" dst="$2"
  if [ -L "$dst" ]; then
    local current
    current="$(readlink "$dst")"
    if [ "$current" = "$src" ]; then
      skip "$dst"
      return
    fi
  fi
  rm -rf "$dst"
  ln -s "$src" "$dst"
  ok "$dst -> $src"
}

# ── 1. Git submodules ───────────────────────────────────────────

info "Initializing git submodules"

if [ ! -f "${JASNAH_DIR}/package.json" ] || [ ! -f "${SAZED_DIR}/package.json" ] || [ ! -f "${HOID_DIR}/package.json" ]; then
  git submodule update --init --recursive
  ok "Submodules initialized"
else
  skip "Submodules already initialized"
fi

# ── 2. Dependencies ────────────────────────────────────────────

info "Installing dependencies"

bun install
ok "bun install complete"

install_ripgrep

# ── 3. Jasnah memory pack ──────────────────────────────────────

info "Setting up Jasnah memory pack"

"${JASNAH_DIR}/install.sh" --project "$SCRIPT_DIR"
ok "Jasnah install complete"

# ── 4. LanceDB vector store ────────────────────────────────────

info "Setting up LanceDB local vector store"

VECTORS_DIR="${MEMORY_DIR}/.vectors"
mkdir -p "$VECTORS_DIR"
ok ".vectors directory created"

# Initial sync + model download (embeds all existing memories)
JASNAH_SYNC="${JASNAH_DIR}/scripts/sync-vector.ts"
if [ -f "$JASNAH_SYNC" ]; then
  if [ -z "${QDRANT_URL:-}" ]; then
    echo "  Running initial vector sync (downloads embedding model on first run ~23 MB)..."
    bun run "$JASNAH_SYNC" --root "$SCRIPT_DIR" 2>&1 | sed 's/^/  /'
    ok "Vector sync complete (LanceDB local backend)"
  else
    echo "  Qdrant configured — running vector sync against Qdrant Cloud..."
    bun run "$JASNAH_SYNC" --root "$SCRIPT_DIR" 2>&1 | sed 's/^/  /'
    ok "Vector sync complete (Qdrant backend)"
  fi
else
  echo "  [warn] sync-vector.ts not found — skipping vector sync"
fi

# ── 5. OpenCode plugins & commands ────────────────────────────

info "Setting up OpenCode integration"

mkdir -p "${OPENCODE_DIR}/plugins" "${OPENCODE_DIR}/commands"

symlink_or_replace \
  "${JASNAH_DIR}/.opencode/plugins/memory-extractor.ts" \
  "${OPENCODE_DIR}/plugins/jasnah-memory-extractor.ts"

symlink_or_replace \
  "${JASNAH_DIR}/.opencode/commands/extract-memory.md" \
  "${OPENCODE_DIR}/commands/extract-memory.md"

# ── 6. Project skills (dalinar/skills/) ────────────────────────

info "Linking project skills"

mkdir -p "$SKILLS_DIR"

# Jasnah skills -> dalinar/skills/ (relative symlinks for portability)
for skill in jasnah-debug-trace jasnah-query jasnah-search-memory jasnah-export-memory; do
  if [ -d "${JASNAH_DIR}/skills/${skill}" ]; then
    symlink_or_replace "../modules/jasnah/skills/${skill}" "${SKILLS_DIR}/${skill}"
  fi
done

# Hoid skills -> dalinar/skills/ (all skills, not just a subset)
for skill in "${HOID_ALL_SKILLS[@]}"; do
  if [ -d "${HOID_SKILLS_DIR}/${skill}" ] && [ -f "${HOID_SKILLS_DIR}/${skill}/SKILL.md" ]; then
    symlink_or_replace "../modules/hoid/packages/skills/${skill}" "${SKILLS_DIR}/${skill}"
  fi
done

# ── 7. Global skills (Claude Code + OpenCode + Codex) ──────────

info "Linking global skills (Claude Code, OpenCode, Codex)"

mkdir -p "$CLAUDE_SKILLS_DIR" "$OPENCODE_SKILLS_DIR" "$CODEX_SKILLS_DIR"

for skill in "${GLOBAL_SKILLS_LIST[@]}"; do
  if [ -d "${SKILLS_DIR}/${skill}" ]; then
    symlink_or_replace "${SKILLS_DIR}/${skill}" "${CLAUDE_SKILLS_DIR}/${skill}"
    symlink_or_replace "${SKILLS_DIR}/${skill}" "${OPENCODE_SKILLS_DIR}/${skill}"
    symlink_or_replace "${SKILLS_DIR}/${skill}" "${CODEX_SKILLS_DIR}/${skill}"
  fi
done

ok "Skills available globally for Claude Code, OpenCode, and Codex"

# ── 8. Hoid calendar config ───────────────────────────────────

info "Setting up Hoid"

HOID_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hoid"
HOID_CONFIG="${HOID_CONFIG_DIR}/hoid.config.json"

if [ ! -f "$HOID_CONFIG" ]; then
  mkdir -p "$HOID_CONFIG_DIR"
  cp "${HOID_DIR}/config/hoid.config.example.json" "$HOID_CONFIG"
  ok "Created ${HOID_CONFIG} from example — edit with your account details"
else
  skip "Hoid config ${HOID_CONFIG}"
fi

# ── 9. Claude Code agents ─────────────────────────────────────

info "Setting up Claude Code agents"

mkdir -p "${CLAUDE_PROJECT}/agents"

if [ -f "${CLAUDE_PROJECT}/agents/effect-idiomatic-critic.md" ]; then
  skip "Agent: effect-idiomatic-critic"
else
  ok "Agent: effect-idiomatic-critic (already in repo)"
fi

# ── 10. Claude Code hooks ──────────────────────────────────────

info "Checking Claude Code hooks"

HOOKS_DIR="${CLAUDE_GLOBAL}/hooks"
mkdir -p "$HOOKS_DIR"

if [ -f "${HOOKS_DIR}/save-session-note.py" ]; then
  ok "SessionEnd hook: save-session-note.py present"
else
  echo "  [warn] No save-session-note.py in ${HOOKS_DIR}/"
  echo "         Copy from your HoldGate project if you want session logging."
fi

# ── 11. Environment file ──────────────────────────────────────

info "Checking environment files"

ENV_FILE="${SCRIPT_DIR}/.env"
ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"

# Create .env.example as a reference (always overwrite to stay current)
cat > "$ENV_EXAMPLE" << 'ENVEOF'
# Dalinar environment configuration
# Copy to .env and fill in your values.

# -- LLM (required for Sazed analysis) --
ANTHROPIC_API_KEY=
# Or use GitHub Copilot as provider:
# LLM_PROVIDER=github-copilot
# LLM_MODEL=gpt-5.2
# (run: bunx @mariozechner/pi-ai login github-copilot)

# -- Jira (required for epic analysis & sync) --
# JIRA_BASE_URL=https://your-org.atlassian.net
# JIRA_EMAIL=you@company.com
# JIRA_API_TOKEN=
# JIRA_PROJECT_KEY=

# -- Sazed tuning --
# TOOL_CALL_BUDGET=25
# REFINEMENT_CONCURRENCY=3
# LLM_MODEL=claude-sonnet-4-20250514

# -- Qdrant (optional — enables semantic memory search) --
# QDRANT_URL=https://your-cluster.cloud.qdrant.io:6333
# QDRANT_API_KEY=

# -- Vault sync (optional — syncs memories to Obsidian) --
# WORK_LOG_PATH=/path/to/obsidian/vault/Work Log

# -- Session hooks (optional — saves session notes to Obsidian inbox) --
# SECOND_BRAIN_PATH=/path/to/obsidian/vault

# -- Database query skill (optional) --
# QUERY_DB_LOCAL=postgres://user:pass@localhost:5432/dbname
# QUERY_DB_STAGING=postgres://...
ENVEOF
ok "Created ${ENV_EXAMPLE}"

if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  ok "Created ${ENV_FILE} from template — edit it with your credentials"
else
  skip ".env file"
fi

# Sazed .env (mirrors root if missing)
SAZED_ENV="${SAZED_DIR}/.env"
if [ ! -f "$SAZED_ENV" ]; then
  ln -s "${ENV_FILE}" "$SAZED_ENV" 2>/dev/null || cp "$ENV_FILE" "$SAZED_ENV"
  ok "Linked Sazed .env -> root .env"
else
  skip "Sazed .env"
fi

# ── 12. JASNAH_ROOT export hint ───────────────────────────────

info "Environment variable hints"

echo ""
echo "  Add these to your shell profile (~/.bashrc or ~/.zshrc) if not set:"
echo ""
echo "    export JASNAH_ROOT=\"${JASNAH_DIR}\""
echo ""

# ── Summary ────────────────────────────────────────────────────

echo ""
echo "========================================"
echo "  Dalinar workspace setup complete"
echo "========================================"
echo ""
echo "  Next steps:"
echo "    1. Edit .env with your API keys (ANTHROPIC_API_KEY, JIRA_*, etc.)"
echo "    2. For GitHub Copilot LLM: bunx @mariozechner/pi-ai login github-copilot"
echo "    3. For Google Calendar:    ./modules/hoid/install.sh calendar"
echo "    4. Edit ${HOID_CONFIG} with your calendar accounts"
echo "    5. Add 'export JASNAH_ROOT=${JASNAH_DIR}' to your shell profile"
echo ""
