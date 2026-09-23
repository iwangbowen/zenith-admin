ALTER TYPE "public"."cms_resource_owner_type" ADD VALUE 'release';--> statement-breakpoint
CREATE TABLE "cms_release_activations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_release_activations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"release_id" integer NOT NULL,
	"from_generation_id" integer,
	"to_generation_id" integer NOT NULL,
	"action" varchar(20) NOT NULL,
	"operator_id" integer,
	"operator_name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_releases" ADD COLUMN "configuration_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_releases" ADD COLUMN "configuration_snapshot" jsonb DEFAULT '{"tables":{},"replaceAll":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_release_activations" ADD CONSTRAINT "cms_release_activations_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_release_activations" ADD CONSTRAINT "cms_release_activations_release_id_cms_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."cms_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_release_activations" ADD CONSTRAINT "cms_release_activations_to_generation_id_cms_deployments_id_fk" FOREIGN KEY ("to_generation_id") REFERENCES "public"."cms_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_release_activations_site_idx" ON "cms_release_activations" USING btree ("site_id","id");
--> statement-breakpoint
CREATE TRIGGER cms_release_activations_immutable BEFORE UPDATE ON cms_release_activations FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();
--> statement-breakpoint
CREATE FUNCTION cms_release_configuration_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.items IS DISTINCT FROM OLD.items OR NEW.configuration_items IS DISTINCT FROM OLD.configuration_items OR NEW.configuration_snapshot IS DISTINCT FROM OLD.configuration_snapshot OR NEW.base_generation_id IS DISTINCT FROM OLD.base_generation_id OR NEW.site_id IS DISTINCT FROM OLD.site_id THEN
    RAISE EXCEPTION 'CMS release inputs are immutable; create another release' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cms_release_inputs_immutable BEFORE UPDATE ON cms_releases FOR EACH ROW EXECUTE FUNCTION cms_release_configuration_immutable();
