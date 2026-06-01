CREATE TABLE "asset_class_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_class" text NOT NULL,
	"return_pct" real NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_class_returns" ADD CONSTRAINT "asset_class_returns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_class_returns_user_id_idx" ON "asset_class_returns" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_class_returns_unique" ON "asset_class_returns" USING btree ("user_id","asset_class");