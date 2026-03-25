CREATE TYPE "public"."region_level" AS ENUM('province', 'city', 'county');--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" varchar(64) NOT NULL,
	"level" "region_level" NOT NULL,
	"parent_code" varchar(12),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regions_code_unique" UNIQUE("code")
);
