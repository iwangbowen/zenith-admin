CREATE TYPE "public"."business_type" AS ENUM('announcement');--> statement-breakpoint
CREATE TABLE "business_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_type" "business_type" NOT NULL,
	"business_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"name" varchar(256),
	"category" varchar(64),
	"sort_order" smallint DEFAULT 0,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_business_file" UNIQUE("business_type","business_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "business_files" ADD CONSTRAINT "business_files_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_files" ADD CONSTRAINT "business_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;