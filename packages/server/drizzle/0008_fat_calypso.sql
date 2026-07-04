ALTER TYPE "public"."payment_channel" ADD VALUE 'unionpay';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'unionpay_qr';--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD COLUMN "unionpay_mer_id" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD COLUMN "unionpay_private_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD COLUMN "unionpay_cert_id" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD COLUMN "unionpay_public_key" text;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD COLUMN "unionpay_gateway" varchar(256);