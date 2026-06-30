/**
 * News-tagging universe — symbols the RSS feeds are matched against so the
 * "in-play" signal can surface MID/SMALL-cap movers (not only the large-cap
 * trading watchlists). These are tracked for NEWS ONLY; the intraday ORB sleeve
 * pulls fresh in-play names from here into its universe. Names are distinctive
 * enough for word-boundary / two-word-phrase matching to stay precise.
 */

export const NEWS_EQUITY_UNIVERSE: Array<{ symbol: string; name: string }> = [
  // Mid-cap
  { symbol: 'DIXON.NS', name: 'Dixon Technologies' },
  { symbol: 'POLYCAB.NS', name: 'Polycab India' },
  { symbol: 'PERSISTENT.NS', name: 'Persistent Systems' },
  { symbol: 'COFORGE.NS', name: 'Coforge' },
  { symbol: 'SUPREMEIND.NS', name: 'Supreme Industries' },
  { symbol: 'ASTRAL.NS', name: 'Astral' },
  { symbol: 'PIIND.NS', name: 'PI Industries' },
  { symbol: 'PHOENIXLTD.NS', name: 'Phoenix Mills' },
  { symbol: 'MAXHEALTH.NS', name: 'Max Healthcare' },
  { symbol: 'LUPIN.NS', name: 'Lupin' },
  { symbol: 'AUROPHARMA.NS', name: 'Aurobindo Pharma' },
  { symbol: 'OBEROIRLTY.NS', name: 'Oberoi Realty' },
  { symbol: 'PRESTIGE.NS', name: 'Prestige Estates' },
  { symbol: 'LICHSGFIN.NS', name: 'LIC Housing Finance' },
  { symbol: 'FEDERALBNK.NS', name: 'Federal Bank' },
  { symbol: 'IDFCFIRSTB.NS', name: 'IDFC First Bank' },
  { symbol: 'INDHOTEL.NS', name: 'Indian Hotels' },
  { symbol: 'VOLTAS.NS', name: 'Voltas' },
  { symbol: 'PAGEIND.NS', name: 'Page Industries' },
  { symbol: 'BALKRISIND.NS', name: 'Balkrishna Industries' },
  { symbol: 'CUMMINSIND.NS', name: 'Cummins India' },
  { symbol: 'DALBHARAT.NS', name: 'Dalmia Bharat' },
  { symbol: 'DEEPAKNTR.NS', name: 'Deepak Nitrite' },
  { symbol: 'AUBANK.NS', name: 'AU Small Finance Bank' },
  { symbol: 'BANDHANBNK.NS', name: 'Bandhan Bank' },
  { symbol: 'ABCAPITAL.NS', name: 'Aditya Birla Capital' },
  { symbol: 'MFSL.NS', name: 'Max Financial Services' },
  { symbol: 'GMRAIRPORT.NS', name: 'GMR Airports' },
  // Small-cap / high-activity
  { symbol: 'KEI.NS', name: 'KEI Industries' },
  { symbol: 'KPITTECH.NS', name: 'KPIT Technologies' },
  { symbol: 'TATAELXSI.NS', name: 'Tata Elxsi' },
  { symbol: 'IRCTC.NS', name: 'IRCTC' },
  { symbol: 'RVNL.NS', name: 'Rail Vikas Nigam' },
  { symbol: 'IRFC.NS', name: 'Indian Railway Finance' },
  { symbol: 'BHEL.NS', name: 'Bharat Heavy Electricals' },
  { symbol: 'SUZLON.NS', name: 'Suzlon Energy' },
  { symbol: 'CDSL.NS', name: 'Central Depository Services' },
  { symbol: 'BSE.NS', name: 'BSE Limited' },
  { symbol: 'YESBANK.NS', name: 'Yes Bank' },
  { symbol: 'IDEA.NS', name: 'Vodafone Idea' },
];

/** Distinctive search aliases from a company name (two-word phrase, or the word). */
export function aliasesFromName(raw0: string): string[] {
  const raw = raw0
    .replace(/\b(Limited|Ltd\.?|Inc\.?|Corp\.?|Pvt\.?|PLC|Co\.?)\b/gi, '')
    .replace(/[^A-Za-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = raw.split(' ').filter(Boolean);
  return words.length >= 2 ? [words.slice(0, 2).join(' ')] : (words[0]?.length >= 3 ? [words[0]] : []);
}
