# Live Candlestick Chart with Yahoo Finance — Technical Spec

A self-contained guide to building an interactive candlestick chart with
**historical data + a live-streaming price** using Yahoo Finance as a free
(unofficial) data source. Covers: history (REST), live (WebSocket → SSE),
the chart library, and pan/zoom. Stack-agnostic; examples in TypeScript/Node +
React, adapt as needed.

> **Constraints to know before you start**
> - Yahoo's chart REST and websocket are **unofficial** — no SLA, can change.
> - **Price only — no order book / market depth (DOM).** DOM requires a broker
>   API (e.g. Zerodha Kite, Upstox) or a paid market-data feed.
> - Some venues' direct APIs (e.g. India's NSE site) **block datacenter/VPS IPs**.
>   Yahoo works from servers anywhere — prefer it for backend use.
> - Freshness: **near-real-time during market hours** (~1–2 min on REST,
>   sub-second on the websocket); outside hours you get the last close.

---

## 1. Symbols

Yahoo uses suffixes to disambiguate exchanges:

| Instrument | Format | Example |
|---|---|---|
| US equity | `<TICKER>` | `AAPL` |
| India NSE | `<TICKER>.NS` | `RELIANCE.NS` |
| India BSE | `<TICKER>.BO` | `RELIANCE.BO` |
| Index | `^<CODE>` | `^NSEI`, `^GSPC` |
| Commodity future | `<CODE>=F` | `GC=F` (gold), `CL=F` (crude) |
| FX | `<PAIR>=X` | `USDINR=X` |
| Crypto | `<PAIR>` | `BTC-USD` |

**Name → symbol search** (so users type "Reliance", not the ticker):
```
GET https://query1.finance.yahoo.com/v1/finance/search?q={query}
→ { quotes: [ { symbol, longname, shortname, exchDisp, typeDisp }, ... ] }
```

---

## 2. History — REST OHLC (polling)

```
GET https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval={INTERVAL}&range={RANGE}
Header: User-Agent: Mozilla/5.0 ...     ← REQUIRED (bare requests get 429 / empty)
```

**Interval ↔ range limits** (Yahoo caps intraday history):

| Interval | Max range | Typical use |
|---|---|---|
| `1m` | ~7 days (use `range=1d`) | today, minute-by-minute |
| `2m`/`5m`/`15m`/`30m` | ~60 days | intraday |
| `1h` | ~730 days | multi-week |
| `1d`/`1wk`/`1mo` | `max` | daily+ history |

**Response (arrays are parallel, indexed together):**
```jsonc
{ "chart": { "result": [ {
  "meta": { "regularMarketPrice": 1310.2, "regularMarketTime": 1782742802,
            "marketState": "REGULAR", "currency": "INR", "gmtoffset": 19800 },
  "timestamp": [1782742500, 1782742800, ...],            // epoch SECONDS, UTC
  "indicators": { "quote": [ { "open":[...], "high":[...],
                               "low":[...], "close":[...], "volume":[...] } ] }
} ], "error": null } }
```

**Parse → bars** (drop indices with any null field — Yahoo leaves gaps):
```ts
async function getBars(symbol: string, interval = '1d', range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await res.json();
  const r = j.chart?.result?.[0];
  if (!r?.timestamp || j.chart?.error) return [];
  const q = r.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o=q.open[i], h=q.high[i], l=q.low[i], c=q.close[i];
    if (o==null||h==null||l==null||c==null) continue;
    bars.push({ time: r.timestamp[i],                       // intraday: epoch secs
                date: new Date(r.timestamp[i]*1000).toISOString().slice(0,10), // daily: yyyy-mm-dd
                open:o, high:h, low:l, close:c });
  }
  return bars;
}
```

Notes:
- **Timestamps are UTC epoch.** Keep them unshifted; convert to local/market
  timezone only at render (§6).
- Add a short cache + timeout; don't hammer (one request per symbol per refresh).
- A current "live" REST price is in `meta.regularMarketPrice` /
  `regularMarketTime` (use during hours; it's the last close otherwise).

---

## 3. Live — WebSocket (push)

```
wss://streamer.finance.yahoo.com/?version=2
```
1. On open, send a subscribe frame:
   ```json
   { "subscribe": ["RELIANCE.NS", "^NSEI"] }
   ```
2. Server pushes:
   ```json
   { "type": "pricing", "message": "<base64-encoded protobuf>" }
   ```
3. Ticks arrive only while the instrument is trading. **Test reachability with a
   24/7 symbol like `BTC-USD`** before assuming it's broken outside market hours.

### 3a. Decode the protobuf tick (`yaticker`)

`message` is base64 protobuf. You only need a few fields — decode the wire format
directly (no protobuf dependency required):

| Field # | Name | Wire type | Read as |
|---|---|---|---|
| 1 | `id` (symbol) | 2 (length-delimited) | UTF-8 string |
| 2 | `price` | 5 (32-bit) | little-endian float |
| 8 | `changePercent` | 5 (32-bit) | little-endian float |
| 10 | `dayHigh` | 5 (32-bit) | float |
| 11 | `dayLow` | 5 (32-bit) | float |
| 3 | `time` (ms) | 0 (varint) | optional (or use client clock) |

```ts
function decodeYaticker(b64: string) {
  const buf = Buffer.from(b64, 'base64'); let i = 0;
  const varint = () => { let r=0,s=0,b; do { b=buf[i++]; r += (b&0x7f)*2**s; s+=7; } while (b & 0x80); return r; };
  const t: any = { id: '' };
  while (i < buf.length) {
    const tag = varint(), field = tag >> 3, wire = tag & 7;
    if (wire === 0) varint();                                  // varint — skip
    else if (wire === 1) i += 8;                               // 64-bit — skip
    else if (wire === 5) { const f = buf.readFloatLE(i); i += 4;
      if (field===2) t.price=f; else if (field===8) t.changePercent=f;
      else if (field===10) t.dayHigh=f; else if (field===11) t.dayLow=f; }
    else if (wire === 2) { const n = varint();
      if (field===1) t.id = buf.subarray(i, i+n).toString('utf8'); i += n; }
    else return null;
  }
  return t.id ? t : null;
}
```

### 3b. Relay through your server (recommended)

Have the **server** hold the Yahoo websocket, decode the protobuf, and forward
clean JSON to the browser over **Server-Sent Events (SSE)**. Why: keeps the
binary decode server-side, lets you auth-gate the stream, dodges browser↔Yahoo
origin/handshake quirks, and one upstream connection can fan out to many clients.

Portable Node example (`ws` package for upstream, plain HTTP/Express for SSE):
```ts
import { WebSocket } from 'ws';
// GET /stream?symbol=RELIANCE.NS  — Express handler
app.get('/stream', (req, res) => {
  const symbol = String(req.query.symbol || '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',          // disable proxy buffering (nginx)
  });
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ type: 'open', symbol });

  const ws = new WebSocket('wss://streamer.finance.yahoo.com/?version=2');
  ws.on('open', () => ws.send(JSON.stringify({ subscribe: [symbol] })));
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type !== 'pricing' || !m.message) return;
      const t = decodeYaticker(m.message);
      if (t?.id === symbol && t.price != null)
        send({ pricePaisa: Math.round(t.price * 100), changePct: t.changePercent, ts: Math.floor(Date.now()/1000) });
    } catch {}
  });

  const beat = setInterval(() => res.write(': ping\n\n'), 25000); // keep-alive
  req.on('close', () => { clearInterval(beat); ws.close(); });    // cleanup on disconnect
});
```
(Next.js Route Handler equivalent: return a `ReadableStream` with the same logic;
set `runtime='nodejs'` and `dynamic='force-dynamic'`. Browsers also have a global
`WebSocket` in Node 22+, so the `ws` package is optional on recent runtimes.)

**Browser consumer:**
```ts
const es = new EventSource(`/stream?symbol=${symbol}`);
es.onmessage = (e) => {
  const d = JSON.parse(e.data);
  if (d.type === 'open') return;
  // d.pricePaisa, d.changePct → update banner + the forming candle (§6)
};
es.onerror = () => {/* will auto-reconnect */};
// es.close() when leaving / switching symbol
```

---

## 4. Money & precision

Store money as integer **minor units** (paisa/cents): `Math.round(price * 100)`.
Format to a currency string only at render. Avoids floating-point drift across
ticks, P&L, and aggregation.

---

## 5. Chart library

Use **[lightweight-charts](https://github.com/tradingview/lightweight-charts)**
(TradingView, MIT, ~45 KB) — built for candlesticks, smooth zoom/pan, real-time
`update()`. (Alternatives: Highcharts Stock, ECharts candlestick — heavier.)

```
npm i lightweight-charts
```

---

## 6. Rendering (lightweight-charts v5)

```ts
const { createChart, CandlestickSeries } = await import('lightweight-charts'); // lazy → no SSR
const chart = createChart(el, {
  autoSize: true, height: 380,
  timeScale: {
    timeVisible: intraday, secondsVisible: false,
    // intraday timestamps render in UTC by default → format to the market's tz:
    tickMarkFormatter: (t) => new Date(t*1000).toLocaleTimeString('en-IN',
      { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
  },
  localization: { timeFormatter: (t) => new Date(t*1000).toLocaleString('en-IN',
      { timeZone: 'Asia/Kolkata', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false }) },
  handleScroll: true, handleScale: true,   // scroll = zoom, drag = pan (these are the defaults)
});
const series = chart.addSeries(CandlestickSeries, {
  upColor:'#059669', downColor:'#e11d48', borderVisible:false,
  wickUpColor:'#059669', wickDownColor:'#e11d48',
});

// time = 'yyyy-mm-dd' for daily bars, or UTCTimestamp (epoch SECONDS) for intraday
const toPoint = (b) => ({ time: b.time ?? b.date, open:b.open, high:b.high, low:b.low, close:b.close });
series.setData(bars.map(toPoint));
chart.timeScale().fitContent();
```

**Live update of the forming candle** (from each SSE tick — use `update`, not `setData`):
```ts
const last = bars[bars.length - 1];
last.close = price;
last.high  = Math.max(last.high, price);
last.low   = Math.min(last.low, price);
series.update(toPoint(last));   // in-place; never disturbs zoom/pan
```

**Timezone:** lightweight-charts always treats `time` as UTC. To show a market's
local time (e.g. IST), don't shift the timestamp — use `tickMarkFormatter`
(axis) and `localization.timeFormatter` (crosshair) to format in the target tz.

---

## 7. Pan & zoom that survive live updates (the key gotcha)

Zoom (mouse-wheel / pinch) and pan (drag) are **built in** to lightweight-charts.
The trap is *losing the user's view on every refresh*. Rules:

1. **Create the chart once and reuse it.** Never recreate it (or call
   `fitContent`) on each data refresh — that resets the viewport.
2. On a data refresh, call `series.setData(newBars)` **without** `fitContent`.
   The library preserves the current visible range → zoom/pan stay put.
3. Call `fitContent()` **only** on first load and when the user changes
   **symbol / interval / range** (track a `resetKey` and refit when it changes).
4. Live ticks use `series.update()` (single bar, in-place) → never affects the view.

Sketch (React, refs persist across renders):
```ts
useEffect(() => { /* create chart once per `intraday` mode; store chart+series in refs */ }, [intraday]);
useEffect(() => { fittedRef.current = false; }, [resetKey]);          // symbol/interval changed → allow one refit
useEffect(() => {                                                     // data refresh
  series.setData(bars.map(toPoint));
  if (!fittedRef.current) { chart.timeScale().fitContent(); fittedRef.current = true; }
}, [bars]);
useEffect(() => { series.update(toPoint(lastWithTick)); }, [liveTick]); // live tick
```

---

## 8. Granularity by timeframe

Drive the interval from what the user is viewing:

| View | interval / range |
|---|---|
| Today (intraday) | `1m` (minute-by-minute) / `range=1d` |
| A few days | `5m` or `15m` |
| Weeks–months | `1h` or `1d` |
| Years | `1d` / `1wk`, `range=1y…max` |

Expose an interval selector for intraday and a range selector for history; pass
the choice into both the OHLC fetch and `resetKey` so the chart refits on change.

---

## 9. Reference architecture

```
Browser (React + lightweight-charts)
  ├─ GET  /ohlc?symbol&interval&range   → historical/intraday bars  (REST, poll ~15s)
  ├─ GET  /quote?symbol                 → current LTP + change       (REST)
  └─ EventSource /stream?symbol         → live ticks                 (SSE)

Server
  ├─ /ohlc, /quote → fetch Yahoo chart REST, parse, (store minor units)
  └─ /stream       → hold Yahoo WebSocket, decodeYaticker(), relay as SSE
```

Suggested modules: a `yahoo-rest` client (search / OHLC / quote), a
`yahoo-stream` decoder (the protobuf reader), three endpoints (`ohlc`, `quote`,
`stream`), and a `CandleChart` component (persistent chart + zoom/pan + live tick).

---

## 10. Pitfalls checklist
- [ ] Always send a `User-Agent` on REST calls (else 429 / empty).
- [ ] Bound every Yahoo call with a timeout; cache + throttle polling.
- [ ] Intraday intervals need short ranges (`1m` ⇒ `range=1d`).
- [ ] Keep timestamps as UTC epoch in state; format to local tz only at render.
- [ ] Store money as integer minor units.
- [ ] **Persist the chart**; refit only on first load / symbol / interval change.
- [ ] WebSocket: subscribe *after* `open`; expect ticks only while trading;
      heartbeat the SSE; **close the upstream ws on client disconnect**.
- [ ] Yahoo gives **no order book** — wire a broker/paid feed if you need depth.
- [ ] These endpoints are unofficial — wrap in try/catch, degrade gracefully,
      and have a fallback (e.g. REST polling if the websocket drops).
