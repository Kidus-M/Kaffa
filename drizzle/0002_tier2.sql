CREATE TABLE "autonomy_policies" (
	"org_id" text NOT NULL,
	"action" text NOT NULL,
	"mode" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autonomy_policies_org_id_action_pk" PRIMARY KEY("org_id","action")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"farmer_id" text NOT NULL,
	"plot_id" text,
	"site_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"kg" integer NOT NULL,
	"delivered_on" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farmer_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"farmer_id" text NOT NULL,
	"name" text NOT NULL,
	"village" text,
	"phone" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"lot_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"detail" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"received_at" text NOT NULL,
	"kind" text NOT NULL,
	"extracted" jsonb,
	"outcome" text NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"shipment_id" text,
	"channel" text NOT NULL,
	"asker" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reg_passages" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"embedding" jsonb,
	"embedding_model" text
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"cooperative_id" text,
	"parent_id" text,
	"synthetic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"field_agent_id" text NOT NULL,
	"plan" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lots" ADD COLUMN "public_code" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "grade_required" text DEFAULT 'G2' NOT NULL;--> statement-breakpoint
CREATE INDEX "deliveries_lot" ON "deliveries" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "deliveries_farmer" ON "deliveries" USING btree ("farmer_id");--> statement-breakpoint
CREATE INDEX "farmer_aliases_farmer" ON "farmer_aliases" USING btree ("farmer_id");--> statement-breakpoint
CREATE INDEX "flags_lot" ON "flags" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_message" ON "inbound_emails" USING btree ("org_id","message_id");--> statement-breakpoint
CREATE INDEX "questions_shipment" ON "questions" USING btree ("shipment_id");