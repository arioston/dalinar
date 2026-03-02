---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - creates isolated git worktrees with smart directory selection and safety verification
---

# Using Git Worktrees

## Overview

Git worktrees create isolated workspaces sharing the same repository, allowing work on multiple branches simultaneously without switching.

**Core principle:** Systematic directory selection + safety verification = reliable isolation.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

## Directory Selection Process

Follow this priority order:

### 1. Check Existing Directories

```bash
# Check in priority order
ls -d .worktrees 2>/dev/null     # Preferred (hidden)
ls -d worktrees 2>/dev/null      # Alternative
```

**If found:** Use that directory. If both exist, `.worktrees` wins.

### 2. Check CLAUDE.md

```bash
grep -i "worktree.*director" CLAUDE.md 2>/dev/null
```

**If preference specified:** Use it without asking.

### 3. Ask User

If no directory exists and no CLAUDE.md preference:

```
No worktree directory found. Where should I create worktrees?

1. .worktrees/ (project-local, hidden)
2. ~/.config/superpowers/worktrees/<project-name>/ (global location)

Which would you prefer?
```

## Safety Verification

### For Project-Local Directories (.worktrees or worktrees)

**MUST verify directory is ignored before creating worktree:**

```bash
# Check if directory is ignored (respects local, global, and system gitignore)
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

**If NOT ignored:**

1. Add appropriate line to .gitignore
2. Commit the change
3. Proceed with worktree creation

**Why critical:** Prevents accidentally committing worktree contents to repository.

### For Global Directory (~/.config/superpowers/worktrees)

No .gitignore verification needed - outside project entirely.

## Creation Steps

### 1. Detect Project Name and Get Ticket ID

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
source_root=$(git rev-parse --show-toplevel)
```

**Get Ticket ID:** If not provided in the request, ask the user:

```
What's the ticket ID for this work? (e.g., PROJ-1234)
```

Use the ticket ID as both the worktree directory name and the branch name.

### 2. Create Worktree

```bash
# Determine full path using ticket ID
case $LOCATION in
  .worktrees|worktrees)
    path="$LOCATION/$TICKET_ID"
    ;;
  ~/.config/superpowers/worktrees/*)
    path="~/.config/superpowers/worktrees/$project/$TICKET_ID"
    ;;
esac

# Create worktree with ticket ID as branch name
git worktree add "$path" -b "$TICKET_ID"
cd "$path"
```

### 3. Copy Environment Files

Copy `.env` and other gitignored config files from source project:

```bash
# Copy .env if it exists in source
if [ -f "$source_root/.env" ]; then
  cp "$source_root/.env" .
fi

# Copy .env.local if it exists
if [ -f "$source_root/.env.local" ]; then
  cp "$source_root/.env.local" .
fi
```

**Why critical:** Worktrees share git history but not gitignored files. Without this step, the worktree lacks database connections, API keys, and other config needed to run.

### 4. Run Project Setup

Auto-detect and run appropriate setup:

```bash
# Bun
if [ -f bun.lock ]; then bun install; fi

# Node.js
if [ -f package-lock.json ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

### 5. Verify Clean Baseline

Run tests to ensure worktree starts clean:

```bash
# Use project-appropriate command
bun test
npm test
cargo test
pytest
go test ./...
```

**If tests fail:** Report failures, ask whether to proceed or investigate.

**If tests pass:** Report ready.

### 6. Report Location

```
Worktree ready at <full-path>
Copied .env from source project
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| No ticket ID provided | Ask user for ticket ID |
| `.worktrees/` exists | Use it (verify ignored) |
| `worktrees/` exists | Use it (verify ignored) |
| Both exist | Use `.worktrees/` |
| Neither exists | Check CLAUDE.md → Ask user |
| Directory not ignored | Add to .gitignore + commit |
| `.env` in source | Copy to worktree |
| `.env.local` in source | Copy to worktree |
| Tests fail during baseline | Report failures + ask |
| No package.json/Cargo.toml | Skip dependency install |

## Common Mistakes

### Making up branch names

- **Problem:** Generic names like `feature/auth` don't tie to tracked work
- **Fix:** Always use ticket ID — ask if not provided

### Skipping ignore verification

- **Problem:** Worktree contents get tracked, pollute git status
- **Fix:** Always use `git check-ignore` before creating project-local worktree

### Forgetting to copy .env

- **Problem:** Worktree can't connect to database, missing API keys, app won't start
- **Fix:** Always copy `.env` and `.env.local` from source project root

### Assuming directory location

- **Problem:** Creates inconsistency, violates project conventions
- **Fix:** Follow priority: existing > CLAUDE.md > ask

### Proceeding with failing tests

- **Problem:** Can't distinguish new bugs from pre-existing issues
- **Fix:** Report failures, get explicit permission to proceed

## Red Flags

**Never:**
- Create worktree without a ticket ID
- Create worktree without verifying it's ignored (project-local)
- Skip copying .env from source project
- Skip baseline test verification
- Proceed with failing tests without asking
- Assume directory location when ambiguous

**Always:**
- Ask for ticket ID if not provided
- Use ticket ID for both worktree directory and branch name
- Follow directory priority: existing > CLAUDE.md > ask
- Verify directory is ignored for project-local
- Copy .env and .env.local from source
- Auto-detect and run project setup
- Verify clean test baseline

## Integration

**Called by:**
- **jira** skill — creates worktree before implementation
- Any skill needing an isolated workspace
