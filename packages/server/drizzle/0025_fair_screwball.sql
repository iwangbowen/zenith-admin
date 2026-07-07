CREATE TABLE "member_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"type" varchar(32) NOT NULL,
	"title" varchar(128) NOT NULL,
	"content" varchar(512),
	"biz_id" varchar(128),
	"read_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "invite_code" varchar(16);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "invited_by" integer;--> statement-breakpoint
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_notifications_member_idx" ON "member_notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "member_notifications_biz_idx" ON "member_notifications" USING btree ("type","biz_id");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_invited_by_members_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_invite_code_unique" ON "members" USING btree ("invite_code") WHERE "members"."invite_code" is not null;--> statement-breakpoint
CREATE INDEX "members_invited_by_idx" ON "members" USING btree ("invited_by");