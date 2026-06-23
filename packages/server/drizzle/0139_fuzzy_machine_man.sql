CREATE TYPE "public"."ssl_cert_status" AS ENUM('valid', 'expiring', 'expired', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."ssl_cert_type" AS ENUM('self_signed', 'uploaded', 'letsencrypt');--> statement-breakpoint
CREATE TABLE "ssl_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"domain" varchar(256) NOT NULL,
	"type" "ssl_cert_type" DEFAULT 'self_signed' NOT NULL,
	"cert_path" varchar(512),
	"key_path" varchar(512),
	"cert_content" text,
	"key_content" text,
	"issuer" varchar(256),
	"subject" varchar(256),
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"fingerprint" varchar(128),
	"serial_number" varchar(128),
	"status" "ssl_cert_status" DEFAULT 'valid' NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;