CREATE TABLE "oauth_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"client_id" varchar(256) DEFAULT '' NOT NULL,
	"client_secret" varchar(512) DEFAULT '' NOT NULL,
	"agent_id" varchar(128),
	"corp_id" varchar(128),
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_configs_provider_unique" UNIQUE("provider")
);
