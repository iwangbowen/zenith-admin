CREATE TABLE "ai_arena_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"question" text NOT NULL,
	"model_a" varchar(100) NOT NULL,
	"model_b" varchar(100) NOT NULL,
	"winner" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_kb_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"kb_id" integer NOT NULL,
	"doc_id" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" real[],
	"token_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_kb_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"kb_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" varchar(20) DEFAULT 'ready' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"error" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_knowledge_bases" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(300),
	"user_id" integer NOT NULL,
	"embedding_model" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_shared_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"about_me" text,
	"reply_style" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "knowledge_base_id" integer;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "models" text[];--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "capabilities" jsonb;--> statement-breakpoint
ALTER TABLE "ai_arena_votes" ADD CONSTRAINT "ai_arena_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_chunks" ADD CONSTRAINT "ai_kb_chunks_kb_id_ai_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."ai_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_chunks" ADD CONSTRAINT "ai_kb_chunks_doc_id_ai_kb_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."ai_kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_documents" ADD CONSTRAINT "ai_kb_documents_kb_id_ai_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."ai_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_knowledge_bases" ADD CONSTRAINT "ai_knowledge_bases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_shared_conversations" ADD CONSTRAINT "ai_shared_conversations_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_shared_conversations" ADD CONSTRAINT "ai_shared_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_user_preferences" ADD CONSTRAINT "ai_user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_shared_conversations_token_uq" ON "ai_shared_conversations" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_user_preferences_user_id_uq" ON "ai_user_preferences" USING btree ("user_id");