/**
 * Minimal dependency-free RSS/Atom parser — extracts items from a feed XML.
 * Handles RSS <item> and Atom <entry>, CDATA, and strips HTML from summaries.
 */

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  publishedAt: Date | null;
  summary: string;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

function atomLink(block: string): string {
  const m = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

export function parseFeed(xml: string): RssItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const items: RssItem[] = [];
  for (const b of blocks) {
    const title = tag(b, 'title');
    const link = tag(b, 'link') || atomLink(b);
    const guid = tag(b, 'guid') || tag(b, 'id') || link;
    if (!title || !guid) continue;
    const dateStr = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const d = dateStr ? new Date(dateStr) : null;
    items.push({
      title,
      link,
      guid,
      publishedAt: d && !isNaN(d.getTime()) ? d : null,
      summary: tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'),
    });
  }
  return items;
}
