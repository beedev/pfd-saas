CREATE TABLE "itr_form_selection" (
	"id" serial PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"selected_form" text NOT NULL,
	"wizard_answers" jsonb NOT NULL,
	"reasoning" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itr_form_selection" ADD CONSTRAINT "itr_form_selection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "itr_form_selection_user_fy_idx" ON "itr_form_selection" USING btree ("user_id","fy");--> statement-breakpoint
CREATE INDEX "itr_form_selection_user_id_idx" ON "itr_form_selection" USING btree ("user_id");