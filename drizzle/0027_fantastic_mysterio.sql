CREATE TABLE "rental_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"real_estate_id" integer NOT NULL,
	"fy" text NOT NULL,
	"rent_received_paisa" bigint NOT NULL,
	"months_let" integer DEFAULT 12 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "rental_history_months_let_check" CHECK ("months_let" BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "rental_history" ADD CONSTRAINT "rental_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_history" ADD CONSTRAINT "rental_history_real_estate_id_real_estate_id_fk" FOREIGN KEY ("real_estate_id") REFERENCES "public"."real_estate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rental_history_user_id_idx" ON "rental_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rental_history_user_fy_idx" ON "rental_history" USING btree ("user_id","fy");--> statement-breakpoint
CREATE INDEX "rental_history_property_idx" ON "rental_history" USING btree ("real_estate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_history_property_fy_unique" ON "rental_history" USING btree ("user_id","real_estate_id","fy");