DROP INDEX "agent_positions_unique_idx";--> statement-breakpoint
DROP INDEX "agent_signals_run_symbol_idx";--> statement-breakpoint
DROP INDEX "agent_trades_one_pending_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "agent_positions_unique_idx" ON "agent_positions" USING btree ("sleeve_id","asset_class","symbol","scheme_code");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_signals_run_symbol_idx" ON "agent_signals" USING btree ("run_id","sleeve_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_trades_one_pending_idx" ON "agent_trades" USING btree ("sleeve_id","symbol","scheme_code") WHERE status = 'PENDING';