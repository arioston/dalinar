import type { JiraTask } from "../jira-schemas.js"
import type { Order } from "../wal/schema.js"
import type { MemorySearchResult } from "../services.js"

export interface TaskRetro {
  readonly taskKey: string
  readonly summary: string
  readonly status: string
  readonly learnings: readonly string[]
  readonly deltas: readonly TaskDelta[]
  readonly surprises: readonly string[]
  readonly walEntryIds: readonly string[]
  readonly jasnahMemoryIds: readonly string[]
}

export interface TaskDelta {
  readonly field: string
  readonly planned: string
  readonly actual: string
}

export function buildTaskRetro(
  task: JiraTask,
  orders: readonly Order[],
  memories: readonly MemorySearchResult[],
): TaskRetro {
  const taskKeyLower = task.key.toLowerCase()

  // 1. Filter orders by ticketKey (case-insensitive)
  const matchingOrders = orders.filter(
    (o) => o.ticketKey.toLowerCase() === taskKeyLower,
  )

  // 2. Extract learnings from lesson-learned memories
  const learnings = memories
    .filter((m) => m.type === "lesson-learned")
    .map((m) => m.summary)

  // 3. Build deltas by comparing WAL order payloads against task current state
  const deltas: TaskDelta[] = []
  for (const order of matchingOrders) {
    const payload = order.payload
    if (!payload) continue

    const payloadAssignee = payload["assignee"] as string | undefined
    if (payloadAssignee != null && String(payloadAssignee) !== String(task.assignee ?? "")) {
      deltas.push({
        field: "assignee",
        planned: String(payloadAssignee),
        actual: String(task.assignee ?? ""),
      })
    }

    const payloadStoryPoints = payload["storyPoints"] as number | undefined
    if (payloadStoryPoints != null && String(payloadStoryPoints) !== String(task.storyPoints ?? "")) {
      deltas.push({
        field: "storyPoints",
        planned: String(payloadStoryPoints),
        actual: String(task.storyPoints ?? ""),
      })
    }

    const payloadStatus = payload["status"] as string | undefined
    if (payloadStatus != null && String(payloadStatus) !== String(task.status)) {
      deltas.push({
        field: "status",
        planned: String(payloadStatus),
        actual: String(task.status),
      })
    }
  }

  // 4. Detect surprises
  const surprises: string[] = []

  const blockActions = matchingOrders.filter(
    (o) => o.action.includes("block") || o.action.includes("unblock"),
  )
  if (blockActions.length > 0) {
    surprises.push("Task was blocked/unblocked")
  }

  const claimReleaseActions = matchingOrders.filter(
    (o) => o.action.includes("claim") || o.action.includes("release"),
  )
  if (claimReleaseActions.length > 1) {
    surprises.push(
      `Task changed hands ${claimReleaseActions.length} times`,
    )
  }

  // 5. Track provenance
  const walEntryIds = matchingOrders.map((o) => o.id)
  const jasnahMemoryIds = memories.map((m) => m.memory_id)

  return {
    taskKey: task.key,
    summary: task.summary,
    status: task.status,
    learnings,
    deltas,
    surprises,
    walEntryIds,
    jasnahMemoryIds,
  }
}
