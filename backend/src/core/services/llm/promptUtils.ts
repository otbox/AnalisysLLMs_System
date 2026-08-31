// promptUtils.ts
//
// Two responsibilities:
//  1. resolveImageDimensions — reads PNG/JPEG/WEBP header bytes from a
//     base64 string and returns the real pixel dimensions WITHOUT any extra
//     library dependency (pure Node Buffer arithmetic).
//
//  2. interpolatePrompt — replaces {{KEY}} tokens in a prompt template with
//     a supplied variables map.  Currently used to inject IMAGE_WIDTH and
//     IMAGE_HEIGHT so every profile prompt always sees the real resolution.

export interface ImageDimensions {
  width:  number;
  height: number;
}

/**
 * Read image dimensions from a raw base64 string (with or without data-URI
 * prefix).  Supports PNG, JPEG, and WEBP headers without any dependency.
 *
 * Returns { width: 0, height: 0 } when the format is not recognised so the
 * rest of the pipeline can still proceed with a graceful fallback.
 */
export function resolveImageDimensions(base64OrDataUri: string): ImageDimensions {
  try {
    const pure = base64OrDataUri.includes(",")
      ? base64OrDataUri.split(",")[1]
      : base64OrDataUri;

    const buf = Buffer.from(pure, "base64");

    // ── PNG: 8-byte signature + 4-byte chunk-len + "IHDR" + 4W + 4H ─────
    if (
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    ) {
      // bytes 16-19: width, 20-23: height (big-endian uint32)
      return {
        width:  buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      };
    }

    // ── JPEG: scan for SOF0 / SOF2 markers ──────────────────────────────
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset < buf.length - 8) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1];
        const len    = buf.readUInt16BE(offset + 2);
        // SOF markers: 0xC0 SOF0, 0xC1 SOF1, 0xC2 SOF2 … 0xCF (excl. 0xC4/0xCC)
        if (
          marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        ) {
          return {
            height: buf.readUInt16BE(offset + 5),
            width:  buf.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + len;
      }
    }

    // ── WEBP: RIFF????WEBP VP8  / VP8L / VP8X ────────────────────────────
    if (
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    ) {
      const chunk = buf.slice(12, 16).toString("ascii");
      if (chunk === "VP8 ") {
        // Lossy: bitstream starts at byte 23, width/height in 14-bit LE fields
        const w = (buf.readUInt16LE(26) & 0x3fff) + 1;
        const h = (buf.readUInt16LE(28) & 0x3fff) + 1;
        return { width: w, height: h };
      }
      if (chunk === "VP8L") {
        // Lossless: 1 signature byte then 28-bit packed w/h
        const bits = buf.readUInt32LE(21);
        const w    = (bits & 0x3fff) + 1;
        const h    = ((bits >> 14) & 0x3fff) + 1;
        return { width: w, height: h };
      }
      if (chunk === "VP8X") {
        // Extended: 24-bit LE w-1 / h-1 at bytes 24 / 27
        const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
        const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
        return { width: w, height: h };
      }
    }

    console.warn("[promptUtils] Unrecognised image format; using 0×0 fallback.");
    return { width: 0, height: 0 };
  } catch (err) {
    console.warn("[promptUtils] resolveImageDimensions error:", (err as Error).message);
    return { width: 0, height: 0 };
  }
}

/**
 * Replace all `{{KEY}}` tokens in `template` with the corresponding value
 * from `vars`.  Unknown tokens are left untouched.
 *
 * Example:
 *   interpolatePrompt("Width: {{IMAGE_WIDTH}}", { IMAGE_WIDTH: 1920 })
 *   // → "Width: 1920"
 */
export function interpolatePrompt(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value !== undefined ? String(value) : match;
  });
}
