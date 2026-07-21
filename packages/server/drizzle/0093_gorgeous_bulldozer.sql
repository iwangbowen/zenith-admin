ALTER TABLE "cms_sites" DROP CONSTRAINT "cms_sites_tenant_id_tenants_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_sites_default_uq" ON "cms_sites" USING btree ("is_default") WHERE "cms_sites"."is_default" = true;--> statement-breakpoint
ALTER TABLE "cms_sites" DROP COLUMN "tenant_id";