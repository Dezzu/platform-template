CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_key" text NOT NULL,
	"description_key" text,
	"stripe_product_id" text,
	"stripe_price_id_monthly" text,
	"stripe_price_id_yearly" text,
	"amount_monthly" integer DEFAULT 0 NOT NULL,
	"amount_yearly" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"api_version" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_percent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "plan_active_sort_idx" ON "plan" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "stripe_event_type_idx" ON "stripe_event" USING btree ("type");--> statement-breakpoint
CREATE INDEX "stripe_event_received_at_idx" ON "stripe_event" USING btree ("received_at");