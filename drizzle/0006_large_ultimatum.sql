ALTER TABLE "budget_carry_forward" DROP CONSTRAINT "budget_carry_forward_period_unique";--> statement-breakpoint
ALTER TABLE "insurance_policies" DROP CONSTRAINT "insurance_policies_policy_number_unique";--> statement-breakpoint
ALTER TABLE "nps_accounts" DROP CONSTRAINT "nps_accounts_account_number_unique";--> statement-breakpoint
ALTER TABLE "provident_fund" DROP CONSTRAINT "provident_fund_account_number_unique";--> statement-breakpoint
DROP INDEX "alert_history_dedup_idx";--> statement-breakpoint
DROP INDEX "budget_category_period_idx";--> statement-breakpoint
DROP INDEX "carryforward_category_idx";--> statement-breakpoint
DROP INDEX "cc_expense_liability_period_idx";--> statement-breakpoint
DROP INDEX "fy_close_fy_cat_idx";--> statement-breakpoint
DROP INDEX "holdings_symbol_unique";--> statement-breakpoint
DROP INDEX "policy_number_idx";--> statement-breakpoint
DROP INDEX "invoice_number_idx";--> statement-breakpoint
DROP INDEX "nps_account_number_idx";--> statement-breakpoint
DROP INDEX "snapshot_unique_idx";--> statement-breakpoint
DROP INDEX "projection_category_period_idx";--> statement-breakpoint
DROP INDEX "retirement_asset_unique_idx";--> statement-breakpoint
DROP INDEX "payment_period_idx";--> statement-breakpoint
DROP INDEX "tax_pref_fy_section_idx";--> statement-breakpoint
DROP INDEX "vendors_gstin_idx";--> statement-breakpoint
DROP INDEX "plan_fy_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "budget_carry_forward_period_unique" ON "budget_carry_forward" USING btree ("user_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "provident_fund_account_number_unique" ON "provident_fund" USING btree ("user_id","account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_history_dedup_idx" ON "alert_history" USING btree ("user_id","dedup_key");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_category_period_idx" ON "budget_entries" USING btree ("user_id","category_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "carryforward_category_idx" ON "carryforward_balances" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cc_expense_liability_period_idx" ON "credit_card_expenses" USING btree ("user_id","liability_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "fy_close_fy_cat_idx" ON "fy_close_status" USING btree ("user_id","financial_year","category");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_symbol_unique" ON "holdings" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_number_idx" ON "insurance_policies" USING btree ("user_id","policy_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_number_idx" ON "invoices" USING btree ("user_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "nps_account_number_idx" ON "nps_accounts" USING btree ("user_id","account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_unique_idx" ON "price_snapshots" USING btree ("user_id","asset_symbol","price_date");--> statement-breakpoint
CREATE UNIQUE INDEX "projection_category_period_idx" ON "projection_entries" USING btree ("user_id","category_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_asset_unique_idx" ON "retirement_asset_selection" USING btree ("user_id","asset_class","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_period_idx" ON "tax_payments" USING btree ("user_id","return_period");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_pref_fy_section_idx" ON "tax_section_preferences" USING btree ("user_id","financial_year","section");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_gstin_idx" ON "vendors" USING btree ("user_id","gstin");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_fy_idx" ON "yearly_investment_plan" USING btree ("user_id","financial_year");