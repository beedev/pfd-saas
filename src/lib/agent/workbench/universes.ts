/**
 * Universe registry — the "pond" a strategy fishes in. Separate from the DSL (the
 * signal / "when"): a strategy declares meta.universe, and the backtest/validation
 * runs it over that universe's symbols. Broad market + Nifty sector groupings, so
 * thematic ideas ("pharma breakouts", "bank momentum") are first-class. Curated
 * constituent lists (liquid names); extend by adding a key here — no code churn.
 */

import { NIFTY_500 } from '../universe/nifty500';

export interface UniverseDef { key: string; label: string; symbols: string[] }
const ns = (arr: string[]) => arr.map((s) => `${s}.NS`);

export const UNIVERSES: Record<string, UniverseDef> = {
  NIFTY_500: { key: 'NIFTY_500', label: 'Nifty 500 (broad market)', symbols: [...NIFTY_500] },
  NIFTY_50: { key: 'NIFTY_50', label: 'Nifty 50 (large cap)', symbols: ns(['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'ITC', 'BHARTIARTL', 'SBIN', 'HINDUNILVR', 'LT', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE', 'ASIANPAINT', 'MARUTI', 'SUNPHARMA', 'TITAN', 'ONGC', 'NTPC', 'TATAMOTORS', 'ULTRACEMCO', 'NESTLEIND', 'WIPRO', 'M&M', 'POWERGRID', 'HCLTECH', 'ADANIENT', 'JSWSTEEL', 'TATASTEEL', 'COALINDIA', 'BAJAJFINSV', 'HDFCLIFE', 'GRASIM', 'SBILIFE', 'BPCL', 'BRITANNIA', 'EICHERMOT', 'TECHM', 'INDUSINDBK', 'DRREDDY', 'CIPLA', 'HEROMOTOCO', 'APOLLOHOSP', 'TATACONSUM', 'HINDALCO', 'ADANIPORTS', 'BAJAJ-AUTO']) },
  NIFTY_PHARMA: { key: 'NIFTY_PHARMA', label: 'Nifty Pharma', symbols: ns(['SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'LUPIN', 'AUROPHARMA', 'TORNTPHARM', 'ALKEM', 'ZYDUSLIFE', 'GLENMARK', 'BIOCON', 'LAURUSLABS', 'MANKIND', 'ABBOTINDIA', 'IPCALAB', 'GRANULES', 'NATCOPHARM', 'AJANTPHARM']) },
  NIFTY_BANK: { key: 'NIFTY_BANK', label: 'Nifty Bank', symbols: ns(['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'BANKBARODA', 'PNB', 'IDFCFIRSTB', 'AUBANK', 'FEDERALBNK', 'BANDHANBNK']) },
  NIFTY_IT: { key: 'NIFTY_IT', label: 'Nifty IT', symbols: ns(['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'LTIM', 'PERSISTENT', 'COFORGE', 'MPHASIS', 'LTTS']) },
  NIFTY_AUTO: { key: 'NIFTY_AUTO', label: 'Nifty Auto', symbols: ns(['MARUTI', 'M&M', 'TATAMOTORS', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO', 'TVSMOTOR', 'ASHOKLEY', 'BALKRISIND', 'MRF', 'MOTHERSON', 'BHARATFORG']) },
  NIFTY_FMCG: { key: 'NIFTY_FMCG', label: 'Nifty FMCG', symbols: ns(['HINDUNILVR', 'ITC', 'NESTLEIND', 'VBL', 'BRITANNIA', 'TATACONSUM', 'GODREJCP', 'DABUR', 'MARICO', 'COLPAL', 'UBL', 'PGHH']) },
  NIFTY_METAL: { key: 'NIFTY_METAL', label: 'Nifty Metal', symbols: ns(['TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'JINDALSTEL', 'SAIL', 'NMDC', 'HINDZINC', 'NATIONALUM', 'APLAPOLLO', 'JSL']) },
  NIFTY_ENERGY: { key: 'NIFTY_ENERGY', label: 'Nifty Energy', symbols: ns(['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'COALINDIA', 'BPCL', 'IOC', 'GAIL', 'TATAPOWER', 'ADANIGREEN', 'ADANIENSOL']) },
  NIFTY_REALTY: { key: 'NIFTY_REALTY', label: 'Nifty Realty', symbols: ns(['DLF', 'GODREJPROP', 'LODHA', 'OBEROIRLTY', 'PRESTIGE', 'PHOENIXLTD', 'BRIGADE']) },
  NIFTY_FIN_SERVICE: { key: 'NIFTY_FIN_SERVICE', label: 'Nifty Financial Services', symbols: ns(['HDFCBANK', 'ICICIBANK', 'BAJFINANCE', 'BAJAJFINSV', 'SBILIFE', 'HDFCLIFE', 'KOTAKBANK', 'AXISBANK', 'SBIN', 'SHRIRAMFIN', 'CHOLAFIN', 'ICICIPRULI']) },
};

export const universeKeys = (): string[] => Object.keys(UNIVERSES);
export const resolveUniverse = (key: string | undefined): string[] => (key && UNIVERSES[key] ? UNIVERSES[key].symbols : UNIVERSES.NIFTY_500.symbols);
export const universeLabel = (key: string | undefined): string => (key && UNIVERSES[key] ? UNIVERSES[key].label : UNIVERSES.NIFTY_500.label);
