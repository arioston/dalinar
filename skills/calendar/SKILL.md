---
name: calendar
description: Unified calendar operations across Google Calendar and Microsoft Graph
depends-on:
  - modules/hoid
---

# Calendar Skill

Provides calendar operations via the Hoid module — unified interface across Google Calendar and Microsoft Graph, supporting multiple accounts per provider.

## Setup

### Quick start (recommended — uses gcloud ADC)

1. Run the install script (installs gcloud if needed, runs Google login):
   ```bash
   ./modules/hoid/install.sh
   ```

2. Add the account to hoid (choose "adc" auth method):
   ```bash
   bun run modules/hoid/packages/cli/src/calendar-auth.ts --add
   ```

3. For additional Google accounts:
   ```bash
   gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/calendar.events
   bun run modules/hoid/packages/cli/src/calendar-auth.ts --add
   ```

### Alternative auth methods

For OAuth (client ID + secret) or service account setups:
```bash
bun run modules/hoid/packages/cli/src/calendar-auth.ts --add
# Choose "oauth" or "service_account" when prompted
```

### Check status

```bash
bun run modules/hoid/packages/cli/src/calendar-auth.ts --status
```

## Operations

### List Events
```bash
bun run modules/hoid/packages/cli/src/calendar-list.ts --days 7 --json
bun run modules/hoid/packages/cli/src/calendar-list.ts --from 2024-01-01 --to 2024-01-07 --account work-google
```

### Find Free Slots
```bash
bun run modules/hoid/packages/cli/src/calendar-free-slots.ts --days 5 --min-duration 30 --working-hours 9-17 --json
```

### Create Event
```bash
bun run modules/hoid/packages/cli/src/calendar-create.ts \
  --title "Team Standup" \
  --start "2024-01-15T09:00:00" \
  --end "2024-01-15T09:30:00" \
  --account work-google --json
```

### Move Event
```bash
# Same account
bun run modules/hoid/packages/cli/src/calendar-move.ts \
  --event-id EVENT_ID --source work-google \
  --new-start "2024-01-15T10:00:00" --new-end "2024-01-15T10:30:00"

# Cross-account (creates on target, deletes from source)
bun run modules/hoid/packages/cli/src/calendar-move.ts \
  --event-id EVENT_ID --source work-google --target personal-google \
  --new-start "2024-01-15T10:00:00" --new-end "2024-01-15T10:30:00"
```

### Detect Conflicts
```bash
bun run modules/hoid/packages/cli/src/calendar-conflicts.ts --days 7 --json
```

## Orchestrator Integration

From Dalinar pipelines:
```typescript
import { hoidListEvents, hoidFreeSlots, hoidConflicts } from "@dalinar/orchestrator"

const events = await hoidListEvents({ days: 7 })
const slots = await hoidFreeSlots({ workingHours: "9-17", minDuration: 30 })
const conflicts = await hoidConflicts({ days: 7 })
```

## Troubleshooting

Run diagnostics on all accounts:
```bash
bun run modules/hoid/packages/cli/src/calendar-auth.ts --doctor
```

Diagnose a single account:
```bash
bun run modules/hoid/packages/cli/src/calendar-auth.ts --doctor --account work-google
```

The `--doctor` command checks:
- Config validity and token file presence
- Token expiry status
- Google: calendarId sanity, token refresh, Calendar API reachability
- Microsoft: tenantId validity, auth flow compatibility, client secret configuration, token refresh, Graph API reachability

Common issues and hints are shown automatically when API calls fail (e.g., API not enabled, wrong tenant, expired tokens).

## Config

Location resolution: `$HOID_CONFIG` → `$XDG_CONFIG_HOME/hoid/hoid.config.json` → `~/.config/hoid/hoid.config.json`

Token storage: `~/.config/hoid/tokens/<tag>.json`
