/**
 * Hoid integration for the Dalinar orchestrator.
 *
 * Provides programmatic access to Hoid's calendar operations.
 * Invokes CLI scripts via subprocess for isolation.
 */

import { $ } from "bun";
import { resolve } from "path";

// ── Types ─────────────────────────────────────────────────────────

export interface CalendarListOptions {
  from?: string;
  to?: string;
  days?: number;
  account?: string;
}

export interface FreeSlotsOptions {
  from?: string;
  to?: string;
  days?: number;
  minDuration?: number;
  workingHours?: string;
  account?: string;
}

export interface CreateEventOptions {
  account?: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}

export interface MoveEventOptions {
  eventId: string;
  source: string;
  newStart: string;
  newEnd: string;
  target?: string;
}

export interface ConflictsOptions {
  from?: string;
  to?: string;
  days?: number;
  account?: string;
}

// ── Resolve Hoid root ─────────────────────────────────────────────

function resolveHoidRoot(): string {
  return process.env.HOID_ROOT
    ?? resolve(process.env.DALINAR_ROOT ?? process.cwd(), "modules/hoid");
}

function cliScript(name: string): string {
  return resolve(resolveHoidRoot(), `packages/cli/src/${name}.ts`);
}

// ── Operations ────────────────────────────────────────────────────

export async function listEvents(opts: CalendarListOptions = {}): Promise<string> {
  const args: string[] = ["--json"];
  if (opts.from) args.push("--from", opts.from);
  if (opts.to) args.push("--to", opts.to);
  if (opts.days) args.push("--days", String(opts.days));
  if (opts.account) args.push("--account", opts.account);

  const result = await $`bun run ${cliScript("calendar-list")} ${args}`
    .quiet()
    .nothrow()
    .env({ ...process.env });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    console.warn(`[dalinar] Hoid listEvents failed: ${stderr}`);
    return "[]";
  }
  return result.stdout.toString().trim();
}

export async function freeSlots(opts: FreeSlotsOptions = {}): Promise<string> {
  const args: string[] = ["--json"];
  if (opts.from) args.push("--from", opts.from);
  if (opts.to) args.push("--to", opts.to);
  if (opts.days) args.push("--days", String(opts.days));
  if (opts.minDuration) args.push("--min-duration", String(opts.minDuration));
  if (opts.workingHours) args.push("--working-hours", opts.workingHours);
  if (opts.account) args.push("--account", opts.account);

  const result = await $`bun run ${cliScript("calendar-free-slots")} ${args}`
    .quiet()
    .nothrow()
    .env({ ...process.env });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    console.warn(`[dalinar] Hoid freeSlots failed: ${stderr}`);
    return "[]";
  }
  return result.stdout.toString().trim();
}

export async function createEvent(opts: CreateEventOptions): Promise<string> {
  const args: string[] = [
    "--json",
    "--title", opts.title,
    "--start", opts.start,
    "--end", opts.end,
  ];
  if (opts.account) args.push("--account", opts.account);
  if (opts.description) args.push("--description", opts.description);
  if (opts.location) args.push("--location", opts.location);

  const result = await $`bun run ${cliScript("calendar-create")} ${args}`
    .quiet()
    .nothrow()
    .env({ ...process.env });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Hoid createEvent failed: ${stderr}`);
  }
  return result.stdout.toString().trim();
}

export async function moveEvent(opts: MoveEventOptions): Promise<string> {
  const args: string[] = [
    "--json",
    "--event-id", opts.eventId,
    "--source", opts.source,
    "--new-start", opts.newStart,
    "--new-end", opts.newEnd,
  ];
  if (opts.target) args.push("--target", opts.target);

  const result = await $`bun run ${cliScript("calendar-move")} ${args}`
    .quiet()
    .nothrow()
    .env({ ...process.env });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Hoid moveEvent failed: ${stderr}`);
  }
  return result.stdout.toString().trim();
}

export async function conflicts(opts: ConflictsOptions = {}): Promise<string> {
  const args: string[] = ["--json"];
  if (opts.from) args.push("--from", opts.from);
  if (opts.to) args.push("--to", opts.to);
  if (opts.days) args.push("--days", String(opts.days));
  if (opts.account) args.push("--account", opts.account);

  const result = await $`bun run ${cliScript("calendar-conflicts")} ${args}`
    .quiet()
    .nothrow()
    .env({ ...process.env });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    console.warn(`[dalinar] Hoid conflicts failed: ${stderr}`);
    return "[]";
  }
  return result.stdout.toString().trim();
}
