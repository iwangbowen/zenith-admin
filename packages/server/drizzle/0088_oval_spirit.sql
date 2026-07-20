CREATE TABLE "cms_channel_users" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "cms_channel_users_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "dept_id" integer;--> statement-breakpoint
ALTER TABLE "cms_channel_users" ADD CONSTRAINT "cms_channel_users_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channel_users" ADD CONSTRAINT "cms_channel_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_channel_users_user_idx" ON "cms_channel_users" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;