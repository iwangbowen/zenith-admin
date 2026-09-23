CREATE TABLE "cms_distribution_sync_states" (
	"content_id" integer PRIMARY KEY NOT NULL,
	"source_version" integer NOT NULL,
	"baseline" jsonb NOT NULL,
	"target_owned_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending" jsonb,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD COLUMN "synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_distribution_sync_states" ADD CONSTRAINT "cms_distribution_sync_states_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_sync_states" ADD CONSTRAINT "cms_distribution_sync_states_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_sync_states" ADD CONSTRAINT "cms_distribution_sync_states_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;