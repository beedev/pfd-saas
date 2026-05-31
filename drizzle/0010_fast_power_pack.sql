CREATE TABLE "vehicle_insurance_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"insurer" text NOT NULL,
	"policy_number" text NOT NULL,
	"insurance_type" text NOT NULL,
	"idv_paisa" bigint NOT NULL,
	"premium_paisa" bigint NOT NULL,
	"own_damage_premium_paisa" bigint,
	"third_party_premium_paisa" bigint,
	"ncb_percent" real DEFAULT 0,
	"addons" text,
	"premium_frequency" text DEFAULT 'ANNUAL' NOT NULL,
	"start_date" text NOT NULL,
	"renewal_date" text NOT NULL,
	"claims_made_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"policy_document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_puc" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"certificate_number" text NOT NULL,
	"issued_date" text NOT NULL,
	"valid_until" text NOT NULL,
	"issuing_authority" text,
	"cost_paisa" bigint DEFAULT 0,
	"certificate_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_service_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"service_date" text NOT NULL,
	"odometer_km" integer,
	"service_type" text NOT NULL,
	"garage_name" text,
	"cost_paisa" bigint DEFAULT 0 NOT NULL,
	"description" text,
	"next_service_due_date" text,
	"next_service_due_km" integer,
	"invoice_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"registration_number" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"variant" text,
	"year" integer NOT NULL,
	"fuel_type" text NOT NULL,
	"transmission" text,
	"color" text,
	"body_type" text,
	"purchase_date" text NOT NULL,
	"purchase_price_paisa" bigint NOT NULL,
	"current_idv_paisa" bigint,
	"odometer_km" integer DEFAULT 0,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"sold_date" text,
	"sale_price_paisa" bigint,
	"rc_document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_insurance_policies" ADD CONSTRAINT "vehicle_insurance_policies_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_insurance_policies" ADD CONSTRAINT "vehicle_insurance_policies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_puc" ADD CONSTRAINT "vehicle_puc_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_puc" ADD CONSTRAINT "vehicle_puc_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_service_log" ADD CONSTRAINT "vehicle_service_log_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_service_log" ADD CONSTRAINT "vehicle_service_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_insurance_user_id_idx" ON "vehicle_insurance_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicle_insurance_vehicle_idx" ON "vehicle_insurance_policies" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_insurance_renewal_idx" ON "vehicle_insurance_policies" USING btree ("renewal_date");--> statement-breakpoint
CREATE INDEX "vehicle_puc_user_id_idx" ON "vehicle_puc" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicle_puc_vehicle_idx" ON "vehicle_puc" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_puc_valid_until_idx" ON "vehicle_puc" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "vehicle_service_user_id_idx" ON "vehicle_service_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicle_service_vehicle_idx" ON "vehicle_service_log" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_service_date_idx" ON "vehicle_service_log" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX "vehicles_user_id_idx" ON "vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_registration_unique" ON "vehicles" USING btree ("user_id","registration_number");