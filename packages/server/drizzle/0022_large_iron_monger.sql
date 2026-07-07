DROP INDEX "members_phone_unique";--> statement-breakpoint
DROP INDEX "members_email_unique";--> statement-breakpoint
DROP INDEX "members_username_unique";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "members_phone_unique" ON "members" USING btree ("phone") WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_unique" ON "members" USING btree ("email") WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_username_unique" ON "members" USING btree ("username") WHERE "members"."deleted_at" is null;