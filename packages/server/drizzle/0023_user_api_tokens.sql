CREATE TABLE "user_api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"token" varchar(128) NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_api_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD CONSTRAINT "user_api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
