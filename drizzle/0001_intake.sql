CREATE TABLE "intake_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"cooperative_id" text NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"created_count" integer NOT NULL,
	"review_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"idx" integer NOT NULL,
	"data" jsonb NOT NULL,
	"review_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"plot_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "intake_rows_batch" ON "intake_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "intake_rows_status" ON "intake_rows" USING btree ("org_id","status");