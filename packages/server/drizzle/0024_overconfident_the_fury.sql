CREATE TABLE "identity_access_grant_menus" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "identity_access_grant_menus_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"grant_id" integer NOT NULL,
	"menu_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_access_grant_menus_unique" UNIQUE("grant_id","menu_id")
);
--> statement-breakpoint
CREATE TABLE "identity_access_request_menus" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "identity_access_request_menus_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" integer NOT NULL,
	"menu_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_access_request_menus_unique" UNIQUE("request_id","menu_id")
);
--> statement-breakpoint
ALTER TABLE "identity_role_versions" ADD COLUMN "menu_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_access_grant_menus" ADD CONSTRAINT "identity_access_grant_menus_grant_id_identity_access_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."identity_access_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_access_grant_menus" ADD CONSTRAINT "identity_access_grant_menus_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_access_request_menus" ADD CONSTRAINT "identity_access_request_menus_request_id_identity_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."identity_access_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_access_request_menus" ADD CONSTRAINT "identity_access_request_menus_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_access_grant_menus_grant_idx" ON "identity_access_grant_menus" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "identity_access_grant_menus_menu_idx" ON "identity_access_grant_menus" USING btree ("menu_id");--> statement-breakpoint
CREATE INDEX "identity_access_request_menus_request_idx" ON "identity_access_request_menus" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "identity_access_request_menus_menu_idx" ON "identity_access_request_menus" USING btree ("menu_id");
--> statement-breakpoint
CREATE TRIGGER identity_access_grant_menus_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "identity_access_grant_menus"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('grant_id');
