---
name: jira
description: Use when user provides a Jira ticket ID (PROJ-XXXX) and wants end-to-end implementation - fetches ticket, creates worktree, implements, pushes, creates PR, and comments on ticket
depends-on: [using-git-worktrees, jasnah-search-memory]
---

# Jira - End-to-End Ticket Implementation

## Overview

Orchestrates the full lifecycle of implementing a Jira ticket: fetch requirements, create isolated workspace, implement, push, create PR, and comment on the ticket.

**Core principle:** One command takes a ticket ID and drives the entire workflow from reading the ticket to posting results back.

## Arguments

**Ticket ID** (required): Jira ticket in PROJ-XXXX format (e.g. MYAPP-1234). Extract from user message.

## Setup

Before running any commands, resolve the Dalinar project root (needed because this skill may run from a worktree or different cwd):

```bash
DALINAR_ROOT="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/\.git$||')"
# Fallback: if not in a worktree, use toplevel
[ -z "$DALINAR_ROOT" ] && DALINAR_ROOT="$(git rev-parse --show-toplevel)"
```

All `jira-request.ts` commands below use `$DALINAR_ROOT` to resolve the script path.

## Workflow

```dot
digraph jira_flow {
    rankdir=TB;
    "Parse ticket ID" -> "Fetch Jira ticket";
    "Fetch Jira ticket" -> "Assign + In Progress";
    "Assign + In Progress" -> "Present ticket to user";
    "Present ticket to user" -> "Clarify requirements";
    "Clarify requirements" -> "Search prior context";
    "Search prior context" -> "Create worktree";
    "Create worktree" -> "Implement changes";
    "Implement changes" -> "Push changes";
    "Push changes" -> "Create PR";
    "Create PR" -> "Comment on Jira ticket";
    "Comment on Jira ticket" -> "Extract session memories";
}
```

### Step 1: Fetch Jira Ticket

```bash
bun "$DALINAR_ROOT/skills/jira/jira-request.ts" GET '/rest/api/2/issue/PROJ-XXXX'
```

Extract and present to user:
- **Summary** (title)
- **Description** (requirements)
- **Issue type** (Bug, Task, etc.)
- **Acceptance criteria** (if present)
- **Comments** (for additional context)

### Step 1b: Assign Ticket and Move to In Progress

**Assign to current user:**

```bash
bun "$DALINAR_ROOT/skills/jira/jira-request.ts" GET '/rest/api/2/myself'
```

Use the `accountId` from the response:

```bash
bun "$DALINAR_ROOT/skills/jira/jira-request.ts" PUT '/rest/api/2/issue/PROJ-XXXX' --body '{"fields":{"assignee":{"accountId":"ACCOUNT_ID"}}}'
```

**Move to In Progress** (skip if already In Progress):

First get available transitions:

```bash
bun "$DALINAR_ROOT/skills/jira/jira-request.ts" GET '/rest/api/2/issue/PROJ-XXXX/transitions'
```

Find the transition whose `to.name` is "In Progress", then:

```bash
bun "$DALINAR_ROOT/skills/jira/jira-request.ts" POST '/rest/api/2/issue/PROJ-XXXX/transitions' --body '{"transition":{"id":"TRANSITION_ID"}}'
```

### Step 1c: Clarify Requirements (if needed)

Review the ticket requirements for ambiguity. If any of these are true, stop and ask the user before continuing:
- Multiple valid interpretations of what's being asked
- Missing acceptance criteria on a non-trivial change
- Unclear which files/areas of the codebase are affected

If the requirements are clear, proceed directly.

### Step 1d: Search Prior Context

Search Jasnah for any prior knowledge related to the ticket's domain:

```bash
JASNAH="${JASNAH_ROOT:-$HOME/.local/share/jasnah}"
bun run "$JASNAH/scripts/search-memory.ts" "<ticket summary and key terms>"
```

Review results for relevant architecture decisions, lessons learned, or domain facts that should inform the implementation.

### Step 2: Create Worktree

**REQUIRED:** Invoke the `using-git-worktrees` skill with the ticket ID (e.g., PROJ-1234). This creates an isolated branch and workspace.

### Step 3: Implement Changes

Based on the ticket requirements:
1. Plan the implementation
2. Write the code
3. Run tests to verify

### Step 4: Push Changes

Commit and push the branch.

### Step 5: Create PR

Create a PR targeting the appropriate base branch. Capture the PR URL.

### Step 6: Comment on Jira Ticket

Post a comment summarizing what was implemented and linking the PR:

```bash
bun "$DALINAR_ROOT/skills/jira/jira-request.ts" POST '/rest/api/2/issue/PROJ-XXXX/comment' --body '{
  "body": "Implementation complete.\n\n*Changes:*\n- Summary of what was done\n\n*Pull Request:*\nPR_URL_HERE"
}'
```

### Step 7: Extract Session Memories

After the ticket is complete, extract any new knowledge gained during implementation:

```bash
JASNAH="${JASNAH_ROOT:-$HOME/.local/share/jasnah}"
bun run "$JASNAH/scripts/extract-inline.ts" --root "$PWD" --source "jira-PROJ-XXXX"
```

This captures architecture decisions, lessons learned, and domain facts for future tickets.

## Quick Reference

| Step | Tool | What Happens |
|------|------|-------------|
| Fetch ticket | `jira-request.ts GET` | Get requirements from Jira |
| Assign + transition | `jira-request.ts PUT/POST` | Assign to self, move to In Progress |
| Clarify requirements | Conversation | Ask if ambiguous |
| Search prior context | `search-memory.ts` | Find relevant prior knowledge |
| Create worktree | `using-git-worktrees` skill | Isolated branch + workspace |
| Implement | Write code + tests | Satisfy ticket requirements |
| Push | git commit + push | Push branch to remote |
| Create PR | `gh pr create` | PR targeting base branch |
| Comment | `jira-request.ts POST` | Link PR back to ticket |
| Extract memories | `extract-inline.ts` | Capture session knowledge |

## Common Mistakes

### Skipping the ticket fetch
- **Problem:** Implementing without understanding full requirements
- **Fix:** Always fetch and read the ticket first, present summary to user

### Not using worktree
- **Problem:** Working in dirty main workspace, branch conflicts
- **Fix:** Always create worktree via the skill for isolation

### Forgetting the Jira comment
- **Problem:** Ticket has no record of implementation or PR link
- **Fix:** Always post comment with changes summary and PR URL
