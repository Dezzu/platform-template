CREATE TYPE "public"."deletion_request_status" AS ENUM('scheduled', 'awaiting_billing', 'cancelled', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."deletion_subject_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."gdpr_export_scope" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."gdpr_export_status" AS ENUM('pending', 'processing', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "gdpr_export_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"scope" "gdpr_export_scope" NOT NULL,
	"status" "gdpr_export_status" DEFAULT 'pending' NOT NULL,
	"object_key" text,
	"size_bytes" bigint,
	"expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "deletion_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"requested_by_user_id" text,
	"status" "deletion_request_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gdpr_export_request" ADD CONSTRAINT "gdpr_export_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gdpr_export_request" ADD CONSTRAINT "gdpr_export_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_request" ADD CONSTRAINT "deletion_request_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gdpr_export_user_idx" ON "gdpr_export_request" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "gdpr_export_sweep_idx" ON "gdpr_export_request" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_request_open_uq" ON "deletion_request" USING btree ("subject_type","subject_id") WHERE status in ('scheduled', 'awaiting_billing');--> statement-breakpoint
CREATE INDEX "deletion_request_due_idx" ON "deletion_request" USING btree ("status","scheduled_for");