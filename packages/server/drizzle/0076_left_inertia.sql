CREATE TABLE "cms_search_words" (
	"id" serial PRIMARY KEY NOT NULL,
	"word" varchar(50) NOT NULL,
	"weight" integer DEFAULT 1000 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_search_words_word_unique" UNIQUE("word")
);
--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD CONSTRAINT "cms_search_words_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD CONSTRAINT "cms_search_words_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;