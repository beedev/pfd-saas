# Live Candlestick Chart — .NET 10 server + MAUI (LiveCharts2)

A self-contained spec for a live-streaming candlestick chart using **Yahoo
Finance** as the (free, unofficial) data source, with:

- **Server:** ASP.NET Core on **.NET 10** — fetches history (REST), holds the
  Yahoo **WebSocket**, decodes the protobuf tick, and relays **SSE**.
- **Client:** **.NET MAUI** mobile app — consumes the SSE stream and renders with
  **LiveCharts2** (`CandlesticksSeries`), with pinch-zoom + pan.

> **Constraints**
> - Yahoo's chart REST + websocket are **unofficial** (no SLA; can change).
> - **Price only — no order book / market depth.** Depth needs a broker API or paid feed.
> - Some exchange sites (e.g. India's NSE) **block datacenter IPs** — Yahoo works
>   from servers anywhere; prefer it server-side.
> - Freshness: **near-real-time during market hours** (~1–2 min REST, sub-second WS);
>   last close otherwise.

---

## 1. Symbols

| Instrument | Format | Example |
|---|---|---|
| US equity | `<TICKER>` | `AAPL` |
| India NSE | `<TICKER>.NS` | `RELIANCE.NS` |
| India BSE | `<TICKER>.BO` | `RELIANCE.BO` |
| Index | `^<CODE>` | `^NSEI` |
| Commodity future | `<CODE>=F` | `GC=F` |
| FX / crypto | `<PAIR>=X` / `<PAIR>` | `USDINR=X`, `BTC-USD` |

Name → symbol: `GET https://query1.finance.yahoo.com/v1/finance/search?q={q}` →
`quotes[]` `{ symbol, longname, exchDisp, typeDisp }`.

---

## 2. Server (.NET 10) — History via REST

```
GET https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval={INTERVAL}&range={RANGE}
Header: User-Agent: Mozilla/5.0 ...   (REQUIRED — else 429/empty)
```
Interval↔range limits: `1m`⇒`range=1d` (max ~7d); `5m/15m/30m`⇒~60d; `1h`⇒~730d;
`1d/1wk/1mo`⇒`max`. `timestamp[]` is **epoch seconds (UTC)**; `indicators.quote[0]`
has parallel `open/high/low/close[]`.

```csharp
public record Bar(long Time, double Open, double High, double Low, double Close);

static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

public static async Task<List<Bar>> GetBarsAsync(string symbol, string interval = "1d", string range = "1y", CancellationToken ct = default)
{
    var url = $"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(symbol)}?interval={interval}&range={range}";
    using var req = new HttpRequestMessage(HttpMethod.Get, url);
    req.Headers.UserAgent.ParseAdd("Mozilla/5.0");
    using var res = await Http.SendAsync(req, ct);
    if (!res.IsSuccessStatusCode) return new();
    using var doc = JsonDocument.Parse(await res.Content.ReadAsStreamAsync(ct));
    var result = doc.RootElement.GetProperty("chart").GetProperty("result")[0];
    if (!result.TryGetProperty("timestamp", out var ts)) return new();
    var q = result.GetProperty("indicators").GetProperty("quote")[0];
    var (o, h, l, c) = (q.GetProperty("open"), q.GetProperty("high"), q.GetProperty("low"), q.GetProperty("close"));
    var bars = new List<Bar>();
    for (int i = 0; i < ts.GetArrayLength(); i++)
    {
        if (o[i].ValueKind is JsonValueKind.Null || c[i].ValueKind is JsonValueKind.Null) continue; // gaps
        bars.Add(new Bar(ts[i].GetInt64(), o[i].GetDouble(), h[i].GetDouble(), l[i].GetDouble(), c[i].GetDouble()));
    }
    return bars;
}
```
Keep timestamps as UTC epoch; convert to market tz only at render. Cache + throttle.

Minimal-API endpoints:
```csharp
app.MapGet("/ohlc",  async (string symbol, string? interval, string? range, CancellationToken ct)
    => Results.Json(await YahooRest.GetBarsAsync(symbol, interval ?? "1d", range ?? "1y", ct)));
```

---

## 3. Server (.NET 10) — Live WebSocket + protobuf decode

Yahoo streamer: `wss://streamer.finance.yahoo.com/?version=2`. After connect send
`{"subscribe":["RELIANCE.NS"]}`; it pushes `{"type":"pricing","message":"<base64 protobuf>"}`.
Ticks arrive only while trading (test reachability with `BTC-USD`, 24/7).

**Decode the `yaticker` protobuf** — only a few fields needed; read the wire
format directly (no Google.Protobuf dependency required):

| Field | Name | Wire type | Read |
|---|---|---|---|
| 1 | id (symbol) | 2 len-delimited | UTF-8 |
| 2 | price | 5 (32-bit) | float LE |
| 8 | changePercent | 5 | float LE |
| 10 / 11 | dayHigh / dayLow | 5 | float LE |

```csharp
public record Tick(string Id, float? Price, float? ChangePercent, float? DayHigh, float? DayLow);

public static Tick? DecodeYaticker(string b64)
{
    var buf = Convert.FromBase64String(b64);
    int i = 0;
    ulong Varint() { ulong r = 0; int s = 0; byte b; do { b = buf[i++]; r |= (ulong)(b & 0x7f) << s; s += 7; } while ((b & 0x80) != 0); return r; }
    string id = ""; float? price = null, chg = null, dh = null, dl = null;
    while (i < buf.Length)
    {
        ulong tag = Varint(); int field = (int)(tag >> 3), wire = (int)(tag & 7);
        switch (wire)
        {
            case 0: Varint(); break;                                   // varint — skip
            case 1: i += 8; break;                                     // 64-bit — skip
            case 5:                                                    // 32-bit float (LE on x86/ARM)
                float f = BitConverter.ToSingle(buf, i); i += 4;
                if (field == 2) price = f; else if (field == 8) chg = f;
                else if (field == 10) dh = f; else if (field == 11) dl = f;
                break;
            case 2:                                                    // length-delimited
                int n = (int)Varint();
                if (field == 1) id = Encoding.UTF8.GetString(buf, i, n);
                i += n; break;
            default: return null;
        }
    }
    return string.IsNullOrEmpty(id) ? null : new Tick(id, price, chg, dh, dl);
}
```
(Alternative: define a `yaticker.proto` and use `Google.Protobuf`; the manual
decoder above avoids the codegen step.)

---

## 4. Server (.NET 10) — SSE relay endpoint

One Yahoo `ClientWebSocket` per stream; decode; write `data: {json}\n\n`; flush;
heartbeat; clean up on client disconnect (`CancellationToken` = `RequestAborted`).

```csharp
app.MapGet("/stream", async (string symbol, HttpContext ctx, CancellationToken ct) =>
{
    ctx.Response.Headers.ContentType = "text/event-stream";
    ctx.Response.Headers.CacheControl = "no-cache, no-transform";
    ctx.Response.Headers["X-Accel-Buffering"] = "no";   // disable proxy buffering

    async Task Send(object o)
    {
        await ctx.Response.WriteAsync($"data: {JsonSerializer.Serialize(o)}\n\n", ct);
        await ctx.Response.Body.FlushAsync(ct);
    }
    await Send(new { type = "open", symbol });

    using var ws = new ClientWebSocket();
    await ws.ConnectAsync(new Uri("wss://streamer.finance.yahoo.com/?version=2"), ct);
    var sub = JsonSerializer.SerializeToUtf8Bytes(new { subscribe = new[] { symbol } });
    await ws.SendAsync(sub, WebSocketMessageType.Text, true, ct);

    // heartbeat keeps idle proxies from closing the SSE
    using var beat = new Timer(async _ => { try { await ctx.Response.WriteAsync(": ping\n\n", ct); await ctx.Response.Body.FlushAsync(ct); } catch { } },
                               null, TimeSpan.FromSeconds(25), TimeSpan.FromSeconds(25));

    var buffer = new byte[16 * 1024];
    var sb = new StringBuilder();
    while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
    {
        WebSocketReceiveResult r;
        sb.Clear();
        do { r = await ws.ReceiveAsync(buffer, ct); sb.Append(Encoding.UTF8.GetString(buffer, 0, r.Count)); }
        while (!r.EndOfMessage);
        if (r.MessageType == WebSocketMessageType.Close) break;

        try
        {
            using var d = JsonDocument.Parse(sb.ToString());
            if (d.RootElement.TryGetProperty("type", out var ty) && ty.GetString() == "pricing"
                && d.RootElement.TryGetProperty("message", out var msg))
            {
                var t = YahooStream.DecodeYaticker(msg.GetString()!);
                if (t is not null && t.Id == symbol && t.Price is float p)
                    await Send(new { pricePaisa = (long)Math.Round(p * 100), changePct = t.ChangePercent, ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds() });
            }
        }
        catch { /* ignore bad frame */ }
    }
});
```
Notes: `app.UseWebSockets()` is **not** needed (we're a websocket *client*, not
server). Run behind HTTP/2-capable Kestrel; SSE works over HTTP/1.1 and HTTP/2.

---

## 5. Money & precision

Store money as integer minor units (paisa/cents): `(long)Math.Round(price*100)`.
Format to currency only at render. Avoids float drift across ticks and P&L.

---

## 6. Client (MAUI) — consume SSE

.NET has no `EventSource`; read the stream with `HttpClient` (start reading before
the full body via `ResponseHeadersRead`) and parse `data:` lines. Marshal UI
updates onto the main thread.

```csharp
public async Task StreamAsync(string symbol, Action<long, double?> onTick, CancellationToken ct)
{
    using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
    using var res = await http.GetAsync($"{BaseUrl}/stream?symbol={Uri.EscapeDataString(symbol)}",
                                        HttpCompletionOption.ResponseHeadersRead, ct);
    res.EnsureSuccessStatusCode();
    using var stream = await res.Content.ReadAsStreamAsync(ct);
    using var reader = new StreamReader(stream);
    while (!ct.IsCancellationRequested)
    {
        var line = await reader.ReadLineAsync(ct);
        if (line is null) break;                          // server closed → caller may reconnect
        if (!line.StartsWith("data:")) continue;          // ignore ":" heartbeats / blank lines
        var json = line.AsSpan(5).Trim();
        using var d = JsonDocument.Parse(json.ToString());
        var root = d.RootElement;
        if (root.TryGetProperty("pricePaisa", out var pp))
        {
            long pricePaisa = pp.GetInt64();
            double? chg = root.TryGetProperty("changePct", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetDouble() : null;
            MainThread.BeginInvokeOnMainThread(() => onTick(pricePaisa, chg));
        }
    }
}
```
Run in a background task; cancel + dispose when leaving the page or switching
symbol; reconnect with backoff if the read ends.

---

## 7. Client (MAUI) — chart with LiveCharts2

NuGet: **`LiveChartsCore.SkiaSharpView.Maui`** (LiveCharts2). Register in
`MauiProgram`:
```csharp
builder.UseMauiApp<App>().UseLiveCharts(); // or UseSkiaSharp(); per LiveCharts2 docs for your version
```

Use **`CandlesticksSeries<FinancialPointI>`** (or `FinancialPoint`). A financial
point carries `(X/Date, High, Open, Close, Low)`.

**ViewModel:**
```csharp
public partial class ChartVm : ObservableObject
{
    public ObservableCollection<FinancialPoint> Candles { get; } = new();

    public ISeries[] Series { get; }
    public Axis[] XAxes { get; }
    public Axis[] YAxes { get; } = { new Axis() };

    public ChartVm()
    {
        Series = new ISeries[]
        {
            new CandlesticksSeries<FinancialPoint>
            {
                Values = Candles,
                UpFill = new SolidColorPaint(SKColor.Parse("#059669")),
                DownFill = new SolidColorPaint(SKColor.Parse("#e11d48")),
            }
        };
        XAxes = new[]
        {
            new Axis
            {
                // FinancialPoint.Date is plotted on X; format to market tz (IST):
                Labeler = v => new DateTime((long)v).ToString("dd MMM HH:mm"),
                UnitWidth = TimeSpan.FromMinutes(1).Ticks,   // match your interval
                MinStep   = TimeSpan.FromMinutes(1).Ticks,
            }
        };
    }

    public void LoadHistory(IEnumerable<Bar> bars)
    {
        Candles.Clear();
        foreach (var b in bars)
            Candles.Add(new FinancialPoint(
                DateTimeOffset.FromUnixTimeSeconds(b.Time).LocalDateTime, // or convert to IST
                (double)b.High, (double)b.Open, (double)b.Close, (double)b.Low));
    }

    // Live tick → update the forming (last) candle in place.
    public void OnTick(double price)
    {
        if (Candles.Count == 0) return;
        var last = Candles[^1];
        last.Close = price;
        if (price > last.High) last.High = price;
        if (price < last.Low)  last.Low  = price;
        // FinancialPoint implements INotifyPropertyChanged → chart redraws the bar.
        // If your LiveCharts2 version doesn't observe property changes, replace the item:
        // Candles[^1] = new FinancialPoint(last.Date, last.High, last.Open, price, last.Low);
    }
}
```

**XAML — chart + pinch-zoom + pan:**
```xml
<lvc:CartesianChart
    Series="{Binding Series}"
    XAxes="{Binding XAxes}"
    YAxes="{Binding YAxes}"
    ZoomMode="X"          <!-- pinch to zoom (X), drag to pan; "Both" for X+Y -->
    HeightRequest="380" />
```
`xmlns:lvc="clr-namespace:LiveChartsCore.SkiaSharpView.Maui;assembly=LiveChartsCore.SkiaSharpView.Maui"`

**Zoom/pan that survives live updates:**
- LiveCharts2 keeps the current zoom/pan when you mutate `Values` — so updating
  the last `FinancialPoint` (or appending a new one) does **not** reset the view.
- Don't reset `XAxes.MinLimit/MaxLimit` on every tick. Set/clear limits only when
  the user changes symbol/interval (do a one-time `chart` autofit then).
- Optional: enable `DrawMargin`/animations off (`series.AnimationsSpeed = TimeSpan.Zero`)
  for smoother high-frequency updates.

> **LiveCharts2 caveat:** the v2 API surface (point types, `ZoomMode` enum name,
> `UseLiveCharts`) shifts between previews — verify member names against the exact
> `LiveChartsCore.SkiaSharpView.Maui` version you pin.

---

## 8. Granularity by timeframe

| View | interval / range |
|---|---|
| Today | `1m` / `range=1d` |
| Few days | `5m` / `15m` |
| Weeks–months | `1h` / `1d` |
| Years | `1d` / `1wk`, `range=1y…max` |

Expose an interval picker; on change, refetch `/ohlc`, reload `Candles`, and do a
one-time autofit. Keep the SSE stream tied to the symbol (interval doesn't change
the live last price).

---

## 9. Reference architecture

```
MAUI app (LiveCharts2)
  ├─ GET  {server}/ohlc?symbol&interval&range   → history bars   (REST, poll ~15s)
  ├─ GET  {server}/quote?symbol                 → current LTP    (REST)
  └─ HttpClient stream {server}/stream?symbol   → live ticks     (SSE)

ASP.NET Core (.NET 10)
  ├─ /ohlc, /quote → HttpClient → Yahoo chart REST → parse → minor units
  └─ /stream       → ClientWebSocket → Yahoo WS → DecodeYaticker() → SSE
```

---

## 10. Pitfalls checklist
- [ ] Set `User-Agent` on REST calls (else 429/empty).
- [ ] Intraday intervals need short ranges (`1m` ⇒ `range=1d`).
- [ ] Keep timestamps UTC epoch in state; format to market tz at render only.
- [ ] Store money as integer minor units.
- [ ] SSE: flush after each write; send `: ping` heartbeats; honor
      `RequestAborted` to close the upstream `ClientWebSocket`.
- [ ] MAUI: read SSE with `ResponseHeadersRead`; marshal UI updates via
      `MainThread`; reconnect with backoff on stream end.
- [ ] LiveCharts2: mutate the last `FinancialPoint` (don't rebuild the whole
      collection) so zoom/pan persist; don't reset axis limits per tick.
- [ ] Yahoo gives **no order book** — add a broker/paid feed if you need depth.
- [ ] Unofficial endpoints — wrap in try/catch, degrade gracefully, fall back to
      REST polling if the websocket drops.
