CREATE TYPE "public"."mask_type" AS ENUM('phone', 'email', 'id_card', 'name', 'bank_card', 'custom');--> statement-breakpoint
CREATE TABLE "data_mask_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" varchar(64) NOT NULL,
	"field" varchar(64) NOT NULL,
	"label" varchar(64) NOT NULL,
	"mask_type" "mask_type" NOT NULL,
	"custom_rule" jsonb,
	"exempt_role_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_mask_entity_field_unique" UNIQUE("entity","field")
);
--> statement-breakpoint
ALTER TABLE "data_mask_configs" ADD CONSTRAINT "data_mask_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_mask_configs" ADD CONSTRAINT "data_mask_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;