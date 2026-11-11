CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"idx" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plot_id" text NOT NULL,
	"source" text NOT NULL,
	"available" boolean NOT NULL,
	"loss_ha" double precision DEFAULT 0 NOT NULL,
	"alert_count" integer DEFAULT 0 NOT NULL,
	"dataset_version" text NOT NULL,
	"rules_version" text NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cooperatives" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"cooperative_id" text NOT NULL,
	"name" text NOT NULL,
	"name_latin" text,
	"village" text,
	"phone" text,
	"synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"cooperative_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'am' NOT NULL,
	"telegram_chat_id" bigint,
	"registration_token" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gaps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plot_id" text NOT NULL,
	"field_agent_id" text NOT NULL,
	"need" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reminders" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"org_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"at" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "ledger_entries_org_id_seq_pk" PRIMARY KEY("org_id","seq")
);
--> statement-breakpoint
CREATE TABLE "lot_plots" (
	"lot_id" text NOT NULL,
	"plot_id" text NOT NULL,
	CONSTRAINT "lot_plots_lot_id_plot_id_pk" PRIMARY KEY("lot_id","plot_id")
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"shipment_id" text,
	"ref" text NOT NULL,
	"grade" text NOT NULL,
	"quantity_kg" integer NOT NULL,
	"value_usd" integer NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"field_agent_id" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"text_en" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plots" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ref" text NOT NULL,
	"farmer_id" text NOT NULL,
	"cooperative_id" text NOT NULL,
	"field_agent_id" text,
	"geometry" jsonb,
	"declared_area_ha" double precision,
	"area_ha" double precision,
	"status" text DEFAULT 'not_checked' NOT NULL,
	"agreement" double precision,
	"status_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_accepted" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"min_lon" double precision,
	"min_lat" double precision,
	"max_lon" double precision,
	"max_lat" double precision,
	"synthetic" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ref" text NOT NULL,
	"buyer_name" text NOT NULL,
	"destination_port" text NOT NULL,
	"ship_date" text NOT NULL,
	"contract_volume_kg" integer NOT NULL,
	"portal_token" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_steps_run" ON "agent_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "checks_plot" ON "checks" USING btree ("plot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_agents_token" ON "field_agents" USING btree ("registration_token");--> statement-breakpoint
CREATE INDEX "field_agents_chat" ON "field_agents" USING btree ("telegram_chat_id");--> statement-breakpoint
CREATE INDEX "gaps_agent_status" ON "gaps" USING btree ("field_agent_id","status");--> statement-breakpoint
CREATE INDEX "messages_agent" ON "messages" USING btree ("field_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plots_org_ref" ON "plots" USING btree ("org_id","ref");--> statement-breakpoint
CREATE INDEX "plots_status" ON "plots" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_portal_token" ON "shipments" USING btree ("portal_token");