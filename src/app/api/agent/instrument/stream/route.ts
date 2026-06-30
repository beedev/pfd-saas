/**
 * GET /api/agent/instrument/stream?symbol= — Server-Sent Events stream of live
 * prices. The server holds one Yahoo websocket, decodes the protobuf ticks, and
 * relays {pricePaisa, changePct, ts} to the browser as SSE. Closes the upstream
 * ws when the client disconnects. Price only (no order book). Auth-gated.
 */

import { NextRequest } from 'next/server';
import { getSessionUserId } from '@/lib/api/auth-guard';
import { decodeYaticker } from '@/lib/agent/providers/yahoo-stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return new Response('unauthorized', { status: 401 });
  const symbol = (new URL(request.url).searchParams.get('symbol') || '').trim();
  if (!symbol) return new Response('symbol required', { status: 400 });

  const encoder = new TextEncoder();
  let ws: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };
      send({ type: 'open', symbol });
      try {
        ws = new WebSocket('wss://streamer.finance.yahoo.com/?version=2');
        ws.onopen = () => ws?.send(JSON.stringify({ subscribe: [symbol] }));
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(String(e.data)) as { type?: string; message?: string };
            if (m.type !== 'pricing' || !m.message) return;
            const t = decodeYaticker(m.message);
            if (t && t.id === symbol && typeof t.price === 'number') {
              send({ pricePaisa: Math.round(t.price * 100), changePct: t.changePercent ?? null, ts: Math.floor(Date.now() / 1000) });
            }
          } catch { /* ignore bad frame */ }
        };
        ws.onerror = () => send({ type: 'error' });
      } catch {
        send({ type: 'error' });
      }
      // Comment heartbeat keeps the connection from idling out.
      heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { /* closed */ } }, 25000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      try { ws?.close(); } catch { /* ignore */ }
    },
  });

  request.signal.addEventListener('abort', () => {
    if (heartbeat) clearInterval(heartbeat);
    try { ws?.close(); } catch { /* ignore */ }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
