CREATE TABLE "cms_content_op_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_id" integer NOT NULL,
	"action" varchar(30) NOT NULL,
	"detail" varchar(500),
	"operator_id" integer,
	"operator_name" varchar(50) DEFAULT '系统' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_error_prone_words" (
	"id" serial PRIMARY KEY NOT NULL,
	"word" varchar(50) NOT NULL,
	"correction" varchar(50) NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_error_prone_words_word_unique" UNIQUE("word")
);
--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "sub_title" varchar(255);--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "short_title" varchar(100);--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "editor" varchar(50);--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "source_url" varchar(500);--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "is_original" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "top_weight" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "top_expire_at" timestamp;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "mapping_source_id" integer;--> statement-breakpoint
ALTER TABLE "cms_content_op_logs" ADD CONSTRAINT "cms_content_op_logs_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_op_logs" ADD CONSTRAINT "cms_content_op_logs_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_error_prone_words" ADD CONSTRAINT "cms_error_prone_words_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_error_prone_words" ADD CONSTRAINT "cms_error_prone_words_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_content_op_logs_content_idx" ON "cms_content_op_logs" USING btree ("content_id","created_at");--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_mapping_source_id_cms_contents_id_fk" FOREIGN KEY ("mapping_source_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_contents_mapping_source_idx" ON "cms_contents" USING btree ("mapping_source_id");