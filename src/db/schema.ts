/**
 * Kaffa's data model. Every table carries org_id so each exporter's data is isolated.
 * Plot geometry is GeoJSON in jsonb with bounding-box columns (see docs/decisions.md).
 */
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Issue, PlotGeometry, PlotStatus } from "@/domain/types";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const orgId = () => text("org_id").notNull();
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();
const synthetic = () => boolean("synthetic").notNull().default(false);

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const cooperatives = pgTable("cooperatives", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  synthetic: synthetic(),
});

export const fieldAgents = pgTable(
  "field_agents",
  {
    id: id(),
    orgId: orgId(),
    cooperativeId: text("cooperative_id").notNull(),
    name: text("name").notNull(),
    language: text("language", { enum: ["am", "en"] }).notNull().default("am"),
    telegramChatId: bigint("telegram_chat_id", { mode: "number" }),
    registrationToken: text("registration_token").notNull(),
    synthetic: synthetic(),
  },
  (t) => [uniqueIndex("field_agents_token").on(t.registrationToken), index("field_agents_chat").on(t.telegramChatId)],
);

export const farmers = pgTable("farmers", {
  id: id(),
  orgId: orgId(),
  cooperativeId: text("cooperative_id").notNull(),
  name: text("name").notNull(),
  nameLatin: text("name_latin"),
  village: text("village"),
  phone: text("phone"),
  synthetic: synthetic(),
});

export const plots = pgTable(
  "plots",
  {
    id: id(),
    orgId: orgId(),
    ref: text("ref").notNull(),
    farmerId: text("farmer_id").notNull(),
    cooperativeId: text("cooperative_id").notNull(),
    /** The field agent responsible for this plot's data. */
    fieldAgentId: text("field_agent_id"),
    geometry: jsonb("geometry").$type<PlotGeometry | null>(),
    declaredAreaHa: doublePrecision("declared_area_ha"),
    areaHa: doublePrecision("area_ha"),
    status: text("status").$type<PlotStatus>().notNull().default("not_checked"),
    agreement: doublePrecision("agreement"),
    statusReasons: jsonb("status_reasons").$type<string[]>().notNull().default([]),
    issues: jsonb("issues").$type<Issue[]>().notNull().default([]),
    reviewAccepted: boolean("review_accepted").notNull().default(false),
    reviewReason: text("review_reason"),
    minLon: doublePrecision("min_lon"),
    minLat: doublePrecision("min_lat"),
    maxLon: doublePrecision("max_lon"),
    maxLat: doublePrecision("max_lat"),
    synthetic: synthetic(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plots_org_ref").on(t.orgId, t.ref), index("plots_status").on(t.orgId, t.status)],
);

export const checks = pgTable(
  "checks",
  {
    id: id(),
    orgId: orgId(),
    plotId: text("plot_id").notNull(),
    source: text("source").notNull(),
    available: boolean("available").notNull(),
    lossHa: doublePrecision("loss_ha").notNull().default(0),
    alertCount: integer("alert_count").notNull().default(0),
    datasetVersion: text("dataset_version").notNull(),
    rulesVersion: text("rules_version").notNull(),
    /** True when the result came from recorded fixtures, not the live API. */
    simulated: boolean("simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("checks_plot").on(t.plotId)],
);

export const shipments = pgTable(
  "shipments",
  {
    id: id(),
    orgId: orgId(),
    ref: text("ref").notNull(),
    buyerName: text("buyer_name").notNull(),
    destinationPort: text("destination_port").notNull(),
    /** YYYY-MM-DD */
    shipDate: text("ship_date").notNull(),
    contractVolumeKg: integer("contract_volume_kg").notNull(),
    portalToken: text("portal_token").notNull(),
    /** Lowest acceptable grade, e.g. "G2" accepts G1 and G2. */
    gradeRequired: text("grade_required").notNull().default("G2"),
    synthetic: synthetic(),
  },
  (t) => [uniqueIndex("shipments_portal_token").on(t.portalToken)],
);

export const lots = pgTable("lots", {
  id: id(),
  orgId: orgId(),
  shipmentId: text("shipment_id"),
  ref: text("ref").notNull(),
  grade: text("grade").notNull(),
  quantityKg: integer("quantity_kg").notNull(),
  valueUsd: integer("value_usd").notNull(),
  state: text("state", { enum: ["ready", "held"] }).notNull().default("held"),
  /** Unguessable code behind the lot's public QR verification page. */
  publicCode: text("public_code"),
  synthetic: synthetic(),
});

export const lotPlots = pgTable(
  "lot_plots",
  { lotId: text("lot_id").notNull(), plotId: text("plot_id").notNull() },
  (t) => [primaryKey({ columns: [t.lotId, t.plotId] })],
);

export const gaps = pgTable(
  "gaps",
  {
    id: id(),
    orgId: orgId(),
    plotId: text("plot_id").notNull(),
    fieldAgentId: text("field_agent_id").notNull(),
    need: text("need", { enum: ["boundary", "location", "photo", "confirm"] }).notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "resolved", "escalated"] }).notNull().default("open"),
    reminders: integer("reminders").notNull().default(0),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [index("gaps_agent_status").on(t.fieldAgentId, t.status)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    orgId: orgId(),
    fieldAgentId: text("field_agent_id").notNull(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    kind: text("kind").notNull(),
    text: text("text"),
    textEn: text("text_en"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_agent").on(t.fieldAgentId)],
);

export const approvals = pgTable("approvals", {
  id: id(),
  orgId: orgId(),
  kind: text("kind").notNull(),
  subjectId: text("subject_id").notNull(),
  summary: text("summary").notNull(),
  payload: jsonb("payload"),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  decidedBy: text("decided_by"),
  reason: text("reason"),
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    orgId: orgId(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    /** Stored as the exact ISO string that was hashed. */
    at: text("at").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.seq] })],
);

export const agentRuns = pgTable("agent_runs", {
  id: id(),
  orgId: orgId(),
  agent: text("agent").notNull(),
  trigger: text("trigger").notNull(),
  status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull().default("running"),
  summary: text("summary"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  startedAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
});

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: id(),
    runId: text("run_id").notNull(),
    idx: integer("idx").notNull(),
    kind: text("kind", { enum: ["model", "tool", "rule", "note"] }).notNull(),
    name: text("name").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    ms: integer("ms").notNull().default(0),
  },
  (t) => [index("agent_steps_run").on(t.runId)],
);

/** Telegram may deliver an update more than once; this makes processing idempotent. */
export const processedUpdates = pgTable("processed_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  processedAt: createdAt(),
});

/** One uploaded register: a spreadsheet or a photo of a paper ledger. */
export const intakeBatches = pgTable("intake_batches", {
  id: id(),
  orgId: orgId(),
  cooperativeId: text("cooperative_id").notNull(),
  source: text("source", { enum: ["spreadsheet", "photo"] }).notNull(),
  fileName: text("file_name").notNull(),
  rowCount: integer("row_count").notNull(),
  createdCount: integer("created_count").notNull(),
  reviewCount: integer("review_count").notNull(),
  createdAt: createdAt(),
});

/** Every row read from a register. Uncertain rows wait here for a person. */
export const intakeRows = pgTable(
  "intake_rows",
  {
    id: id(),
    orgId: orgId(),
    batchId: text("batch_id").notNull(),
    idx: integer("idx").notNull(),
    data: jsonb("data").notNull(),
    reviewFields: jsonb("review_fields").$type<string[]>().notNull().default([]),
    status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull(),
    plotId: text("plot_id"),
    createdAt: createdAt(),
  },
  (t) => [index("intake_rows_batch").on(t.batchId), index("intake_rows_status").on(t.orgId, t.status)],
);

/** Other spellings a farmer is known by, kept when two records are merged. */
export const farmerAliases = pgTable(
  "farmer_aliases",
  {
    id: id(),
    orgId: orgId(),
    farmerId: text("farmer_id").notNull(),
    name: text("name").notNull(),
    village: text("village"),
    phone: text("phone"),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("farmer_aliases_farmer").on(t.farmerId)],
);

/** Collectors and washing stations: the middle of the custody chain. */
export const sites = pgTable("sites", {
  id: id(),
  orgId: orgId(),
  kind: text("kind", { enum: ["collector", "washing_station"] }).notNull(),
  name: text("name").notNull(),
  cooperativeId: text("cooperative_id"),
  /** For a collector: the washing station it delivers to. */
  parentId: text("parent_id"),
  synthetic: synthetic(),
});

/** Cherry or coffee handed over at a site, traced from plot to lot. Kg are green-coffee equivalent. */
export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    orgId: orgId(),
    farmerId: text("farmer_id").notNull(),
    plotId: text("plot_id"),
    siteId: text("site_id").notNull(),
    lotId: text("lot_id").notNull(),
    kg: integer("kg").notNull(),
    /** YYYY-MM-DD */
    deliveredOn: text("delivered_on").notNull(),
    synthetic: synthetic(),
  },
  (t) => [index("deliveries_lot").on(t.lotId), index("deliveries_farmer").on(t.farmerId)],
);

/** Raised by the supply chain auditor. An open flag holds its lot; clearing one needs a person and a reason. */
export const flags = pgTable(
  "flags",
  {
    id: id(),
    orgId: orgId(),
    kind: text("kind", { enum: ["volume_lot", "volume_farmer", "unmapped_supplier"] }).notNull(),
    lotId: text("lot_id").notNull(),
    subjectId: text("subject_id").notNull(),
    detail: jsonb("detail").notNull(),
    status: text("status", { enum: ["open", "cleared"] }).notNull().default("open"),
    reason: text("reason"),
    createdAt: createdAt(),
    clearedAt: timestamp("cleared_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [index("flags_lot").on(t.lotId)],
);

/** Per-organisation autonomy: whether an agent acts alone, asks first, or does nothing. */
export const autonomyPolicies = pgTable(
  "autonomy_policies",
  {
    orgId: orgId(),
    action: text("action").notNull(),
    mode: text("mode", { enum: ["auto", "ask", "off"] }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.action] })],
);

/** A field agent's planned visits, day by day, in route order. */
export const visitPlans = pgTable("visit_plans", {
  id: id(),
  orgId: orgId(),
  fieldAgentId: text("field_agent_id").notNull(),
  plan: jsonb("plan").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
});

/** Passages of the regulation and guidance, with embeddings, for cited answers. Shared by all organisations. */
export const regPassages = pgTable("reg_passages", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  ref: text("ref").notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  embedding: jsonb("embedding").$type<number[] | null>(),
  embeddingModel: text("embedding_model"),
});

/** A question from a buyer (portal or email) or the exporter, with its cited answer. */
export const questions = pgTable(
  "questions",
  {
    id: id(),
    orgId: orgId(),
    shipmentId: text("shipment_id"),
    channel: text("channel", { enum: ["portal", "email", "console"] }).notNull(),
    asker: text("asker").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    citations: jsonb("citations").$type<{ id: string; label: string }[]>().notNull().default([]),
    status: text("status", { enum: ["answered", "drafted", "needs_person"] }).notNull(),
    mode: text("mode").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("questions_shipment").on(t.shipmentId)],
);

/** Buyer emails read from the exporter's inbox, and what Kaffa made of them. */
export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: id(),
    orgId: orgId(),
    messageId: text("message_id").notNull(),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    receivedAt: text("received_at").notNull(),
    kind: text("kind", { enum: ["contract", "question", "other"] }).notNull(),
    extracted: jsonb("extracted"),
    outcome: text("outcome").notNull(),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inbound_emails_message").on(t.orgId, t.messageId)],
);
