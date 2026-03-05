/**
 * Resolve a Jira issue key to determine if it's an epic or task.
 * If it's a task, resolve the parent epic key.
 *
 * Requires JIRA_EMAIL, JIRA_API_TOKEN, JIRA_URL in env.
 */

import { $ } from "bun"
import { resolve } from "path"

export interface ResolvedKey {
  /** The epic key to use for analysis */
  epicKey: string
  /** The original task key if the input was a task (undefined if input was already an epic) */
  taskKey?: string | undefined
  /** The issue type from Jira */
  issueType: string
  /** The task summary (for enriching search context) */
  taskSummary?: string | undefined
}

function jiraRequestScript(): string {
  const dalinarRoot = process.env.DALINAR_ROOT ?? process.cwd()
  return resolve(dalinarRoot, "skills/jira/jira-request.ts")
}

/**
 * Resolve a key to its epic. If already an epic, returns it as-is.
 * If a task/story/subtask, resolves the parent epic key.
 * Returns null if Jira is not configured or the request fails.
 */
export async function resolveKey(key: string): Promise<ResolvedKey | null> {
  const script = jiraRequestScript()

  try {
    const result = await $`bun run ${script} GET ${`/rest/api/2/issue/${key}?fields=issuetype,parent,customfield_10014,summary`}`
      .quiet()
      .nothrow()

    if (result.exitCode !== 0) {
      return null
    }

    const stdout = result.stdout.toString().trim()
    // Filter out stderr lines (like "→ GET ...")
    const jsonLine = stdout.split("\n").find((l) => l.startsWith("{"))
    if (!jsonLine) return null

    const issue = JSON.parse(jsonLine)
    const issueType = issue.fields?.issuetype?.name ?? ""
    const summary = issue.fields?.summary ?? ""

    // If it's an Epic, return directly
    if (issueType === "Epic") {
      return { epicKey: key, issueType }
    }

    // Otherwise, resolve parent epic
    // Try parent field first (Jira next-gen / Team-managed)
    const parentKey = issue.fields?.parent?.key
    // Then try Epic Link custom field (Jira classic / Company-managed)
    const epicLink = issue.fields?.customfield_10014

    const epicKey = parentKey ?? epicLink
    if (!epicKey) {
      // No parent epic found — use the key itself (best effort)
      return { epicKey: key, issueType, taskSummary: summary }
    }

    return { epicKey, taskKey: key, issueType, taskSummary: summary }
  } catch {
    // Jira not configured or network error — return null to fall through
    return null
  }
}
