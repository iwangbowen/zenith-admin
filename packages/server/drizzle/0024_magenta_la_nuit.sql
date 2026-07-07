CREATE TABLE "member_tag_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_tag_bindings_unique" UNIQUE("member_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "member_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(32) NOT NULL,
	"color" varchar(20),
	"description" varchar(256),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "exchange_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_tag_bindings" ADD CONSTRAINT "member_tag_bindings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tag_bindings" ADD CONSTRAINT "member_tag_bindings_tag_id_member_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."member_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tags" ADD CONSTRAINT "member_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tags" ADD CONSTRAINT "member_tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_tag_bindings_tag_idx" ON "member_tag_bindings" USING btree ("tag_id");