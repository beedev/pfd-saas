/**
 * RSS feeds for the news/research layer. Public, pull-based, no auth.
 * (NSE/BSE corporate announcements are JSON behind nseindia/bseindia, not RSS —
 * they can be added later via the NSE provider; v1 uses the reliable news RSS.)
 */

export interface Feed {
  source: string;
  url: string;
}

export const FEEDS: Feed[] = [
  { source: 'Moneycontrol', url: 'https://www.moneycontrol.com/rss/MCtopnews.xml' },
  { source: 'Moneycontrol', url: 'https://www.moneycontrol.com/rss/marketreports.xml' },
  { source: 'Moneycontrol', url: 'https://www.moneycontrol.com/rss/buzzingstocks.xml' },
  { source: 'Moneycontrol', url: 'https://www.moneycontrol.com/rss/results.xml' },
  { source: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { source: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms' },
  { source: 'Mint', url: 'https://www.livemint.com/rss/markets' },
  { source: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss' },
];
