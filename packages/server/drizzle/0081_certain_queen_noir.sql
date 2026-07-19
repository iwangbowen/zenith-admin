CREATE TABLE "cms_content_channels" (
	"content_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	CONSTRAINT "cms_content_channels_content_id_channel_id_pk" PRIMARY KEY("content_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "cms_content_relations" (
	"content_id" integer NOT NULL,
	"related_id" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cms_content_relations_content_id_related_id_pk" PRIMARY KEY("content_id","related_id")
);
--> statement-breakpoint
ALTER TABLE "cms_ads" ADD COLUMN "click_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_comments" ADD COLUMN "parent_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_comments" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "expire_at" timestamp;--> statement-breakpoint
ALTER TABLE "cms_forms" ADD COLUMN "notify_email" varchar(255);--> statement-breakpoint
ALTER TABLE "cms_content_channels" ADD CONSTRAINT "cms_content_channels_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_channels" ADD CONSTRAINT "cms_content_channels_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_relations" ADD CONSTRAINT "cms_content_relations_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_relations" ADD CONSTRAINT "cms_content_relations_related_id_cms_contents_id_fk" FOREIGN KEY ("related_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;