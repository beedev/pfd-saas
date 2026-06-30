/**
 * Minimal decoder for Yahoo Finance's websocket "pricing" message — an
 * unofficial protobuf (the `yaticker` schema) sent base64-encoded. We only need
 * a few fields, so this walks the wire format directly (no protobuf dependency):
 *   field 1  id            (string)
 *   field 2  price         (float, 32-bit)
 *   field 8  changePercent (float, 32-bit)
 *   field 10 dayHigh       (float, 32-bit)
 *   field 11 dayLow        (float, 32-bit)
 * Unknown fields are skipped by wire type. Returns null on any malformation.
 */

export interface YahooTick {
  id: string;
  price?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
}

export function decodeYaticker(b64: string): YahooTick | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    let i = 0;
    const readVarint = (): number => {
      let result = 0, shift = 0;
      while (i < buf.length) {
        const b = buf[i++];
        result += (b & 0x7f) * 2 ** shift; // multiply (not <<) to stay safe past 31 bits
        if (!(b & 0x80)) break;
        shift += 7;
      }
      return result;
    };
    const t: YahooTick = { id: '' };
    while (i < buf.length) {
      const tag = readVarint();
      const field = tag >> 3, wire = tag & 7;
      if (wire === 0) { readVarint(); }                                   // varint field — skip
      else if (wire === 1) { i += 8; }                                    // 64-bit — skip
      else if (wire === 5) {                                              // 32-bit float
        if (i + 4 > buf.length) break;
        const f = buf.readFloatLE(i); i += 4;
        if (field === 2) t.price = f;
        else if (field === 8) t.changePercent = f;
        else if (field === 10) t.dayHigh = f;
        else if (field === 11) t.dayLow = f;
      } else if (wire === 2) {                                            // length-delimited
        const len = readVarint();
        if (i + len > buf.length) break;
        if (field === 1) t.id = buf.subarray(i, i + len).toString('utf8');
        i += len;
      } else { return null; }                                            // unknown wire type
    }
    return t.id ? t : null;
  } catch {
    return null;
  }
}
