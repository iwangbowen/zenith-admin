CREATE TABLE "channel_message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "channel_message_type" DEFAULT 'text' NOT NULL,
	"title" varchar(200),
	"content" text DEFAULT '' NOT NULL,
	"extra" jsonb,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD COLUMN "rating_comment" text;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_message_templates" ADD CONSTRAINT "channel_message_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_templates" ADD CONSTRAINT "channel_message_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;