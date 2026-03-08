import { Schema } from "effect"

// ── Shared types ──────────────────────────────────────────────────

const ResponseStatus = Schema.Literal("accepted", "declined", "tentative", "needsAction")

const Attendee = Schema.Struct({
  email: Schema.String,
  name: Schema.optional(Schema.String),
  responseStatus: ResponseStatus,
})

const EventStatus = Schema.Literal("confirmed", "tentative", "cancelled")
const Provider = Schema.Literal("google", "microsoft")

export const CalendarEvent = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  provider: Provider,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  start: Schema.String,
  end: Schema.String,
  allDay: Schema.optional(Schema.Boolean),
  status: EventStatus,
  organizer: Schema.optional(Schema.String),
  attendees: Schema.optional(Schema.Array(Attendee)),
  recurring: Schema.optional(Schema.Boolean),
  htmlLink: Schema.optional(Schema.String),
})

export type CalendarEvent = Schema.Schema.Type<typeof CalendarEvent>

// ── calendar-list output ──────────────────────────────────────────

export const CalendarListOutput = Schema.Array(CalendarEvent)
export type CalendarListOutput = Schema.Schema.Type<typeof CalendarListOutput>

// ── calendar-free-slots output ────────────────────────────────────

export const TimeSlot = Schema.Struct({
  start: Schema.String,
  end: Schema.String,
  durationMinutes: Schema.Number,
})

export type TimeSlot = Schema.Schema.Type<typeof TimeSlot>

export const FreeSlotsOutput = Schema.Array(TimeSlot)
export type FreeSlotsOutput = Schema.Schema.Type<typeof FreeSlotsOutput>

// ── calendar-create / calendar-move output ────────────────────────

export const CreateEventOutput = CalendarEvent
export const MoveEventOutput = CalendarEvent

// ── calendar-conflicts output ─────────────────────────────────────

export const Conflict = Schema.Struct({
  eventA: CalendarEvent,
  eventB: CalendarEvent,
  overlapMinutes: Schema.Number,
})

export type Conflict = Schema.Schema.Type<typeof Conflict>

export const ConflictsOutput = Schema.Array(Conflict)
export type ConflictsOutput = Schema.Schema.Type<typeof ConflictsOutput>
