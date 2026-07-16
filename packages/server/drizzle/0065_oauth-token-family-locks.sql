CREATE TABLE "oauth2_token_families" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"user_id" integer,
	"compromised" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth2_token_families" ADD CONSTRAINT "oauth2_token_families_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth2_token_families_client_idx" ON "oauth2_token_families" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth2_token_families_user_idx" ON "oauth2_token_families" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "oauth2_tokens" ADD CONSTRAINT "oauth2_tokens_family_id_oauth2_token_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."oauth2_token_families"("id") ON DELETE cascade ON UPDATE no action;