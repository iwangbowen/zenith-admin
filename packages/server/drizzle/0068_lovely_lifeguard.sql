CREATE TABLE "role_dept_scopes" (
	"role_id" integer NOT NULL,
	"dept_id" integer NOT NULL,
	CONSTRAINT "role_dept_scopes_role_id_dept_id_pk" PRIMARY KEY("role_id","dept_id")
);
--> statement-breakpoint
ALTER TABLE "role_dept_scopes" ADD CONSTRAINT "role_dept_scopes_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_dept_scopes" ADD CONSTRAINT "role_dept_scopes_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;