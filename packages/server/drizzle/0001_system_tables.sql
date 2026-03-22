CREATE TYPE "public"."menu_type" AS ENUM('directory', 'menu', 'button');--> statement-breakpoint
CREATE TABLE "menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer DEFAULT 0 NOT NULL,
	"title" varchar(64) NOT NULL,
	"name" varchar(64),
	"path" varchar(256),
	"icon" varchar(64),
	"type" "menu_type" DEFAULT 'menu' NOT NULL,
	"permission" varchar(128),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" varchar(256),
	"status" "status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_menus" (
	"role_id" integer NOT NULL,
	"menu_id" integer NOT NULL,
	CONSTRAINT "role_menus_role_id_menu_id_pk" PRIMARY KEY("role_id","menu_id")
);
--> statement-breakpoint
CREATE TABLE "dicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" varchar(256),
	"status" "status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dicts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "dict_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"dict_id" integer NOT NULL,
	"label" varchar(64) NOT NULL,
	"value" varchar(64) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"remark" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_dict_id_dicts_id_fk" FOREIGN KEY ("dict_id") REFERENCES "public"."dicts"("id") ON DELETE cascade ON UPDATE no action;
