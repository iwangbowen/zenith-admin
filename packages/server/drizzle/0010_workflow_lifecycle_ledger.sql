CREATE TABLE "workflow_instance_cycles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_instance_cycles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"instance_id" integer NOT NULL,
	"cycle" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"outcome" varchar(32),
	"outcome_reason" varchar(64),
	"tenant_id" integer,
	CONSTRAINT "workflow_instance_cycles_unique" UNIQUE("instance_id","cycle")
);
--> statement-breakpoint
CREATE TABLE "workflow_instance_transitions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_instance_transitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"instance_id" integer NOT NULL,
	"cycle" integer NOT NULL,
	"from_status" "workflow_instance_status",
	"to_status" "workflow_instance_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" integer,
	"tenant_id" integer
);
--> statement-breakpoint
ALTER TABLE "workflow_instance_cycles" ADD CONSTRAINT "workflow_instance_cycles_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance_cycles" ADD CONSTRAINT "workflow_instance_cycles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance_transitions" ADD CONSTRAINT "workflow_instance_transitions_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance_transitions" ADD CONSTRAINT "workflow_instance_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance_transitions" ADD CONSTRAINT "workflow_instance_transitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_instance_cycles_submitted_idx" ON "workflow_instance_cycles" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "workflow_instance_transitions_time_idx" ON "workflow_instance_transitions" USING btree ("instance_id","occurred_at");--> statement-breakpoint
CREATE FUNCTION workflow_record_instance_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ts timestamptz := clock_timestamp(); starting boolean; terminal boolean;
BEGIN
  starting := (TG_OP = 'INSERT' AND NEW.status <> 'draft') OR (TG_OP = 'UPDATE' AND OLD.status IN ('draft','returned') AND NEW.status = 'running');
  terminal := NEW.status IN ('approved','rejected','withdrawn','cancelled');
  IF starting THEN
    NEW.cycle := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE OLD.cycle + 1 END;
    NEW.submitted_at := ts;
    NEW.completed_at := NULL; NEW.outcome_reason := NULL;
  END IF;
  IF terminal AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.completed_at := ts;
    NEW.outcome_reason := coalesce(NEW.outcome_reason, CASE NEW.status WHEN 'approved' THEN 'business_approved' WHEN 'rejected' THEN 'business_rejected' ELSE NEW.status::text END);
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'returned' AND NEW.status = 'running' THEN
    NEW.completed_at := NULL; NEW.outcome_reason := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION workflow_append_instance_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean; ts timestamptz := clock_timestamp(); previous workflow_instance_status;
BEGIN
  changed := TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status;
  IF NOT changed THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN previous := OLD.status; END IF;
  INSERT INTO workflow_instance_transitions(instance_id,cycle,from_status,to_status,occurred_at,actor_id,tenant_id) VALUES(NEW.id,NEW.cycle,previous,NEW.status,ts,NEW.updated_by,NEW.tenant_id);
  IF NEW.cycle > 0 THEN
    INSERT INTO workflow_instance_cycles(instance_id,cycle,submitted_at,tenant_id) VALUES(NEW.id,NEW.cycle,NEW.submitted_at,NEW.tenant_id) ON CONFLICT DO NOTHING;
    IF NEW.status IN ('approved','rejected','withdrawn','cancelled','returned') THEN
      UPDATE workflow_instance_cycles SET completed_at=ts,outcome=NEW.status::text,outcome_reason=NEW.outcome_reason WHERE instance_id=NEW.id AND cycle=NEW.cycle AND completed_at IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER workflow_instance_lifecycle_before BEFORE INSERT OR UPDATE OF status ON workflow_instances FOR EACH ROW EXECUTE FUNCTION workflow_record_instance_lifecycle();
--> statement-breakpoint
CREATE TRIGGER workflow_instance_lifecycle_after AFTER INSERT OR UPDATE OF status ON workflow_instances FOR EACH ROW EXECUTE FUNCTION workflow_append_instance_lifecycle();
