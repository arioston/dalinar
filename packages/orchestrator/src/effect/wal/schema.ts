import { Schema } from "effect"

export class Order extends Schema.Class<Order>("Order")({
  id: Schema.String,
  ticketKey: Schema.String,
  action: Schema.String,
  timestamp: Schema.String,
  payload: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
}) {}

export class OrderLog extends Schema.Class<OrderLog>("OrderLog")({
  orders: Schema.Array(Order),
  lastPromotedAt: Schema.optional(Schema.String),
}) {}

export const OrderLogJson = Schema.parseJson(OrderLog)
