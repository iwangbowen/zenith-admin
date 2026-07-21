CREATE TYPE "public"."cms_poll_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TABLE "cms_poll_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"member_id" integer,
	"voter_key" varchar(64),
	"ip" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_choices" integer DEFAULT 1 NOT NULL,
	"allow_anonymous" boolean DEFAULT true NOT NULL,
	"start_at" timestamp,
	"end_at" timestamp,
	"status" "cms_poll_status" DEFAULT 'draft' NOT NULL,
	"total_votes" integer DEFAULT 0 NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_poll_votes" ADD CONSTRAINT "cms_poll_votes_poll_id_cms_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."cms_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_poll_votes" ADD CONSTRAINT "cms_poll_votes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_polls" ADD CONSTRAINT "cms_polls_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_polls" ADD CONSTRAINT "cms_polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_polls" ADD CONSTRAINT "cms_polls_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_poll_votes_member_uq" ON "cms_poll_votes" USING btree ("poll_id","member_id") WHERE "cms_poll_votes"."member_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_poll_votes_guest_uq" ON "cms_poll_votes" USING btree ("poll_id","voter_key") WHERE "cms_poll_votes"."member_id" is null and "cms_poll_votes"."voter_key" is not null;--> statement-breakpoint
CREATE INDEX "cms_poll_votes_poll_idx" ON "cms_poll_votes" USING btree ("poll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_polls_site_code_uq" ON "cms_polls" USING btree ("site_id","code");