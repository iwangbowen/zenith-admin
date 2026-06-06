ALTER TABLE "login_logs" ADD COLUMN "screen_width" smallint;--> statement-breakpoint
ALTER TABLE "login_logs" ADD COLUMN "screen_height" smallint;--> statement-breakpoint
ALTER TABLE "login_logs" ADD COLUMN "device_pixel_ratio" varchar(8);--> statement-breakpoint
ALTER TABLE "login_logs" ADD COLUMN "gpu" varchar(256);--> statement-breakpoint
ALTER TABLE "login_logs" ADD COLUMN "cpu_cores" smallint;--> statement-breakpoint
ALTER TABLE "login_logs" ADD COLUMN "memory_gb" varchar(8);