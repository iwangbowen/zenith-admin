ALTER TABLE "tenants" DROP CONSTRAINT "tenants_package_id_tenant_packages_id_fk";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_package_id_tenant_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."tenant_packages"("id") ON DELETE restrict ON UPDATE no action;