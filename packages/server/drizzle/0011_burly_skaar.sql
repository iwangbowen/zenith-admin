CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer DEFAULT 0 NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"leader" varchar(32),
	"phone" varchar(32),
	"email" varchar(128),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"remark" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "positions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_positions" (
	"user_id" integer NOT NULL,
	"position_id" integer NOT NULL,
	CONSTRAINT "user_positions_user_id_position_id_pk" PRIMARY KEY("user_id","position_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "user_positions" ADD CONSTRAINT "user_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_positions" ADD CONSTRAINT "user_positions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;