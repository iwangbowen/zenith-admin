ALTER TABLE "cms_contents" ADD COLUMN "member_id" integer;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_contents_member_idx" ON "cms_contents" USING btree ("member_id");