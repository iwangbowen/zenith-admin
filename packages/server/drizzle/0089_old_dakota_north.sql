ALTER TABLE "cms_comments" ADD COLUMN "member_id" integer;--> statement-breakpoint
ALTER TABLE "cms_comments" ADD CONSTRAINT "cms_comments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_comments_member_idx" ON "cms_comments" USING btree ("member_id");