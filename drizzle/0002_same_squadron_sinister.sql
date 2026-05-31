ALTER TABLE "alert_history" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "budget_carry_forward" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "business_profile" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "capital_gains" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "carryforward_balances" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "chit_fund_installments" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "chit_funds" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "credit_card_expenses" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "fixed_deposits" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "future_savings_plan" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "fy_close_status" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "gold_holdings" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "income_tax_paid" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "loan_amortization" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "mutual_funds" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "nps_accounts" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "other_sources_income" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "projection_categories" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "projection_entries" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "provident_fund" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "real_estate" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "retirement_asset_selection" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "retirement_assumptions" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "savings_asset_inclusion" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "sips" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tax_documents" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tax_payments" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tax_section_preferences" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tds_credits" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "yearly_investment_plan" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_carry_forward" ADD CONSTRAINT "budget_carry_forward_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profile" ADD CONSTRAINT "business_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_gains" ADD CONSTRAINT "capital_gains_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carryforward_balances" ADD CONSTRAINT "carryforward_balances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chit_fund_installments" ADD CONSTRAINT "chit_fund_installments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chit_funds" ADD CONSTRAINT "chit_funds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_expenses" ADD CONSTRAINT "credit_card_expenses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_deposits" ADD CONSTRAINT "fixed_deposits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "future_savings_plan" ADD CONSTRAINT "future_savings_plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fy_close_status" ADD CONSTRAINT "fy_close_status_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_holdings" ADD CONSTRAINT "gold_holdings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_tax_paid" ADD CONSTRAINT "income_tax_paid_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_amortization" ADD CONSTRAINT "loan_amortization_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutual_funds" ADD CONSTRAINT "mutual_funds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_accounts" ADD CONSTRAINT "nps_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_sources_income" ADD CONSTRAINT "other_sources_income_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_categories" ADD CONSTRAINT "projection_categories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_entries" ADD CONSTRAINT "projection_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provident_fund" ADD CONSTRAINT "provident_fund_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate" ADD CONSTRAINT "real_estate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_asset_selection" ADD CONSTRAINT "retirement_asset_selection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_assumptions" ADD CONSTRAINT "retirement_assumptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_income" ADD CONSTRAINT "salary_income_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_asset_inclusion" ADD CONSTRAINT "savings_asset_inclusion_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_documents" ADD CONSTRAINT "tax_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_payments" ADD CONSTRAINT "tax_payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_section_preferences" ADD CONSTRAINT "tax_section_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_credits" ADD CONSTRAINT "tds_credits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yearly_investment_plan" ADD CONSTRAINT "yearly_investment_plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_history_user_id_idx" ON "alert_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_rules_user_id_idx" ON "alert_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "budget_carry_forward_user_id_idx" ON "budget_carry_forward" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "budget_categories_user_id_idx" ON "budget_categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "budget_entries_user_id_idx" ON "budget_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "business_profile_user_id_idx" ON "business_profile" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "capital_gains_user_id_idx" ON "capital_gains" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "carryforward_balances_user_id_idx" ON "carryforward_balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chit_fund_installments_user_id_idx" ON "chit_fund_installments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chit_funds_user_id_idx" ON "chit_funds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_card_expenses_user_id_idx" ON "credit_card_expenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "customers_user_id_idx" ON "customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "financial_goals_user_id_idx" ON "financial_goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fixed_deposits_user_id_idx" ON "fixed_deposits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "future_savings_plan_user_id_idx" ON "future_savings_plan" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fy_close_status_user_id_idx" ON "fy_close_status" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gold_holdings_user_id_idx" ON "gold_holdings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "holdings_user_id_idx" ON "holdings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "income_tax_paid_user_id_idx" ON "income_tax_paid" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "insurance_policies_user_id_idx" ON "insurance_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_transactions_user_id_idx" ON "investment_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoice_items_user_id_idx" ON "invoice_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoices_user_id_idx" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "liabilities_user_id_idx" ON "liabilities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "loan_amortization_user_id_idx" ON "loan_amortization" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mutual_funds_user_id_idx" ON "mutual_funds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nps_accounts_user_id_idx" ON "nps_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "other_sources_income_user_id_idx" ON "other_sources_income" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_user_id_idx" ON "price_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projection_categories_user_id_idx" ON "projection_categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projection_entries_user_id_idx" ON "projection_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provident_fund_user_id_idx" ON "provident_fund" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_user_id_idx" ON "purchase_invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "real_estate_user_id_idx" ON "real_estate" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_user_id_idx" ON "recurring_expenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "retirement_asset_selection_user_id_idx" ON "retirement_asset_selection" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "retirement_assumptions_user_id_idx" ON "retirement_assumptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "salary_income_user_id_idx" ON "salary_income" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "savings_asset_inclusion_user_id_idx" ON "savings_asset_inclusion" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sips_user_id_idx" ON "sips" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tax_deductions_user_id_idx" ON "tax_deductions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tax_documents_user_id_idx" ON "tax_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tax_payments_user_id_idx" ON "tax_payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tax_section_preferences_user_id_idx" ON "tax_section_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tds_credits_user_id_idx" ON "tds_credits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendors_user_id_idx" ON "vendors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "yearly_investment_plan_user_id_idx" ON "yearly_investment_plan" USING btree ("user_id");