CREATE TABLE "notice_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"notice_id" integer NOT NULL,
	"recipient_type" varchar(16) NOT NULL,
	"recipient_id" integer NOT NULL,
	CONSTRAINT "uniq_notice_recipient" UNIQUE("notice_id","recipient_type","recipient_id")
);
--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "target_type" varchar(16) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "notice_recipients" ADD CONSTRAINT "notice_recipients_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;