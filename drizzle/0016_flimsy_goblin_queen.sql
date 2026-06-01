CREATE TABLE "transformation_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"text_value" text,
	"estimated_calories" integer,
	"estimated_protein_g" real,
	"estimation_input" text,
	"estimated_at" timestamp,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transformation_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"date" text NOT NULL,
	"day_number" integer,
	"current_weight_kg" real,
	"journal" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transformation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'check' NOT NULL,
	"options" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transformation_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" text NOT NULL,
	"day_count" integer DEFAULT 100 NOT NULL,
	"start_weight_kg" real,
	"goal_weight_kg" real,
	"daily_calorie_target" integer,
	"daily_protein_target_g" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transformation_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "habits_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transformation_checks" ADD CONSTRAINT "transformation_checks_day_id_transformation_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."transformation_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_checks" ADD CONSTRAINT "transformation_checks_item_id_transformation_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."transformation_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_checks" ADD CONSTRAINT "transformation_checks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_days" ADD CONSTRAINT "transformation_days_plan_id_transformation_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."transformation_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_days" ADD CONSTRAINT "transformation_days_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_items" ADD CONSTRAINT "transformation_items_section_id_transformation_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."transformation_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_items" ADD CONSTRAINT "transformation_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_plans" ADD CONSTRAINT "transformation_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_sections" ADD CONSTRAINT "transformation_sections_plan_id_transformation_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."transformation_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_sections" ADD CONSTRAINT "transformation_sections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transformation_checks_user_id_idx" ON "transformation_checks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transformation_checks_day_item_unique" ON "transformation_checks" USING btree ("user_id","day_id","item_id");--> statement-breakpoint
CREATE INDEX "transformation_days_user_id_idx" ON "transformation_days" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transformation_days_plan_date_unique" ON "transformation_days" USING btree ("user_id","plan_id","date");--> statement-breakpoint
CREATE INDEX "transformation_items_user_id_idx" ON "transformation_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transformation_items_section_idx" ON "transformation_items" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "transformation_plans_user_id_idx" ON "transformation_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transformation_sections_user_id_idx" ON "transformation_sections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transformation_sections_plan_idx" ON "transformation_sections" USING btree ("plan_id");