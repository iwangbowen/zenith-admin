ALTER TABLE "identity_access_grant_menus" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identity_access_request_menus" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "identity_access_grant_menus" CASCADE;--> statement-breakpoint
DROP TABLE "identity_access_request_menus" CASCADE;--> statement-breakpoint
ALTER TABLE "identity_access_grant_items" DROP CONSTRAINT "identity_access_grant_items_permission_scope_unique";--> statement-breakpoint
ALTER TABLE "identity_access_grant_items" ADD COLUMN "menu_id" integer;--> statement-breakpoint
ALTER TABLE "identity_access_grant_items" ADD COLUMN "page_title" varchar(64);--> statement-breakpoint
ALTER TABLE "identity_access_grant_items" ADD COLUMN "page_path" varchar(256);--> statement-breakpoint
ALTER TABLE "identity_access_request_items" ADD COLUMN "menu_id" integer;--> statement-breakpoint
ALTER TABLE "identity_access_request_items" ADD COLUMN "page_title" varchar(64);--> statement-breakpoint
ALTER TABLE "identity_access_request_items" ADD COLUMN "page_path" varchar(256);--> statement-breakpoint
ALTER TABLE "identity_access_grant_items" ADD CONSTRAINT "identity_access_grant_items_target_scope_unique" UNIQUE NULLS NOT DISTINCT("grant_id","menu_id","permission_code","scope_key");