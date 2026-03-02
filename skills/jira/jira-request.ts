#!/usr/bin/env bun
import { parseArgs } from "util";

/**
 * Jira API Request Utility (Bun)
 *
 * Usage: bun skills/jira/jira-request.ts <method> <path> [--body <json>]
 *
 * Examples:
 *
 *   # Get current user
 *   bun skills/jira/jira-request.ts GET '/rest/api/2/myself'
 *
 *   # Get a specific issue
 *   bun skills/jira/jira-request.ts GET '/rest/api/2/issue/PROJ-123'
 *
 *   # Search issues
 *   bun skills/jira/jira-request.ts GET '/rest/api/2/search?jql=project=PROJ'
 *
 *   # Create a Task
 *   bun skills/jira/jira-request.ts POST '/rest/api/2/issue' --body '{
 *     "fields": {
 *       "project": {"key": "PROJ"},
 *       "summary": "Ticket title",
 *       "description": "Ticket description",
 *       "issuetype": {"name": "Task"}
 *     }
 *   }'
 *
 *   # Update an issue
 *   bun skills/jira/jira-request.ts PUT '/rest/api/2/issue/PROJ-123' --body '{
 *     "fields": {"summary": "Updated title"}
 *   }'
 *
 *   # Add a comment
 *   bun skills/jira/jira-request.ts POST '/rest/api/2/issue/PROJ-123/comment' --body '{
 *     "body": "Comment text"
 *   }'
 *
 * Environment: Requires JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_URL in env
 */

const VALID_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;
type Method = (typeof VALID_METHODS)[number];

function usage(): never {
  console.error("Usage: bun skills/jira/jira-request.ts <GET|POST|PUT|DELETE> <path> [--body <json>]");
  process.exit(1);
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    body: { type: "string" },
  },
  allowPositionals: true,
});

const [method, path] = positionals;

if (!method || !path) usage();
if (!VALID_METHODS.includes(method as Method)) {
  console.error(`Invalid method: ${method}. Must be one of: ${VALID_METHODS.join(", ")}`);
  process.exit(1);
}

const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error("JIRA_EMAIL and JIRA_API_TOKEN must be set in environment");
  process.exit(1);
}

const jiraUrl = process.env.JIRA_URL;
if (!jiraUrl) {
  console.error("JIRA_URL must be set in environment (e.g. https://yourorg.atlassian.net)");
  process.exit(1);
}
const baseUrl = jiraUrl.replace(/\/$/, "");
const url = `${baseUrl}${path}`;
const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

console.error(`→ ${method} ${url}`);

try {
  const response = await fetch(url, {
    method: method as Method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: values.body ? values.body : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`HTTP ${response.status}: ${response.statusText}`);
    console.error(text.substring(0, 500));
    process.exit(1);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } else {
    const text = await response.text();
    if (text) console.log(text);
    else console.log("(empty response)");
  }
} catch (error) {
  console.error("Request failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
