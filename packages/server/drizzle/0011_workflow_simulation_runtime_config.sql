ALTER TABLE "workflow_simulation_cases" ADD COLUMN "runtime_config" jsonb DEFAULT '{"now":0,"seed":1,"selectedInitiatorApprovers":{}}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "workflow_simulation_cases" ALTER COLUMN "runtime_config" DROP DEFAULT;
