// ImageAnnotation.ts
import sharp from "sharp";

type OutputFormat = "png" | "jpeg" | "webp";

/**
 * Como interpretar os valores de coordenadas recebidos do LLM:
 *
 * "normalized-1000" (padrão) → coordenadas no espaço 0-1000
 *   O prompt instrui o LLM a normalizar: x_real = (x / 1000) * imageWidth
 *
 * "pixels" → coordenadas em pixels reais da imagem (legado / outros prompts)
 */
export type CoordScale = "normalized-1000" | "pixels";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Aceita tanto array [x,y,w,h] quanto objeto {x,y,w,h} */
export type Coordenadas =
  | [number, number, number, number]
  | number[]
  | BoundingBox;

export interface UiElement {
  id?:          string;
  type?:        string;
  text?:        string | null;
  region?:      string;
  /** Array [x,y,w,h] ou objeto {x,y,w,h}. Escala definida por CoordScale. */
  coordenadas:  Coordenadas;
  state?:       string;
  color?:       string;
  actions?:     string[];
  meta?:        Record<string, unknown>;
}

export interface RawResponsePart { text?: string; }

export interface RawResponseCandidate {
  content?: { parts?: RawResponsePart[]; role?: string };
  finishReason?: string;
  index?:        number;
}

export interface AnalysisInput {
  profile?:            string;
  model?:              string;
  action?:             string;
  rationale?:          string;
  confidence?:         number;
  numberOfComponents?: number;
  rawResponse?: {
    candidates?:    RawResponseCandidate[];
    usageMetadata?: Record<string, unknown>;
    modelVersion?:  string;
    responseId?:    string;
  };
  ui?: UiElement[];
}

export interface AnnotateImageParams {
  imageBase64:    string;
  analysis:       AnalysisInput;
  stroke?:        string;
  fill?:          string;
  outputFormat?:  OutputFormat;
  includeLabel?:  boolean;
  /** Escala das coordenadas vindas do LLM. Padrão: "normalized-1000" */
  coordScale?:    CoordScale;
}

export interface AnnotateImageResult {
  buffer:        Buffer;
  base64:        string;
  dataUri:       string;
  mimeType:      string;
  width:         number;
  height:        number;
  elementsCount: number;
}

// ────────────────────────────────────────────────────────────────────────────

export class LlmImageAnnotatorServiceScale {

  public async annotateFromAnalysis(
    params: AnnotateImageParams
  ): Promise<AnnotateImageResult> {
    const {
      imageBase64,
      analysis,
      stroke       = "#ff2d2d",
      fill         = "rgba(255,45,45,0.10)",
      outputFormat = "png",
      includeLabel = false,
      coordScale   = "normalized-1000",   // ← padrão alinhado ao prompt
    } = params;

    const { buffer: inputBuffer } = this.parseBase64Image(imageBase64);

    const image = sharp(inputBuffer);
    const meta  = await image.metadata();

    if (!meta.width || !meta.height) {
      throw new Error("Não foi possível identificar largura/altura da imagem.");
    }

    const ui = this.extractUiElements(analysis);
    if (!ui.length) {
      throw new Error("Nenhum elemento de UI encontrado em analysis.ui ou rawResponse.");
    }

    const overlaySvg = this.buildOverlaySvg({
      width: meta.width,
      height: meta.height,
      ui,
      stroke,
      fill,
      includeLabel,
      coordScale,
    });

    let pipeline = image.composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);

    switch (outputFormat) {
      case "jpeg": pipeline = pipeline.jpeg({ quality: 90 }); break;
      case "webp": pipeline = pipeline.webp({ quality: 90 }); break;
      case "png":
      default:     pipeline = pipeline.png(); break;
    }

    const outputBuffer = await pipeline.toBuffer();
    const mimeType     = this.getMimeType(outputFormat);
    const base64       = outputBuffer.toString("base64");

    return {
      buffer:        outputBuffer,
      base64,
      dataUri:       `data:${mimeType};base64,${base64}`,
      mimeType,
      width:         meta.width,
      height:        meta.height,
      elementsCount: ui.length,
    };
  }

  // ── extração de elementos ──────────────────────────────────────────────────

  private extractUiElements(analysis: AnalysisInput): UiElement[] {
    if (Array.isArray(analysis.ui) && analysis.ui.length > 0) {
      return analysis.ui.filter((item) => this.isValidUiElement(item));
    }

    const rawText = this.extractTextFromRawResponse(analysis);
    if (!rawText) return [];

    const parsed = this.parseUiJsonText(rawText);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item) => this.isValidUiElement(item)) as UiElement[];
  }

  private extractTextFromRawResponse(analysis: AnalysisInput): string | null {
    const candidates = analysis.rawResponse?.candidates;
    if (!Array.isArray(candidates)) return null;

    for (const candidate of candidates) {
      const parts = candidate.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (typeof part?.text === "string" && part.text.trim()) return part.text;
      }
    }
    return null;
  }

  private parseUiJsonText(text: string): unknown {
    const cleaned = text.trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
      if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
      throw new Error("Não foi possível fazer parse do JSON em rawResponse.");
    }
  }

  private isValidUiElement(item: unknown): item is UiElement {
    if (!item || typeof item !== "object") return false;
    const el  = item as UiElement;
    const box = this.coordsToBox(el.coordenadas);
    return (
      this.isFiniteNumber(box.x) &&
      this.isFiniteNumber(box.y) &&
      this.isFiniteNumber(box.w) &&
      this.isFiniteNumber(box.h)
    );
  }

  // ── geração do SVG ──────────────────────────────────────────────────────────

  private buildOverlaySvg(params: {
    width:        number;
    height:       number;
    ui:           UiElement[];
    stroke:       string;
    fill:         string;
    includeLabel: boolean;
    coordScale:   CoordScale;
  }): string {
    const { width, height, ui, stroke, fill, includeLabel, coordScale } = params;

    const strokeWidth = Math.max(2, Math.round(Math.min(width, height) * 0.0035));
    const fontSize    = Math.max(12, Math.round(Math.min(width, height) * 0.018));

    const itemsSvg = ui.map((item) => {
      const raw = this.coordsToBox(item.coordenadas);
      const box = this.denormalizeAndClamp(raw, width, height, coordScale);
      if (!box || box.w <= 0 || box.h <= 0) return "";

      const label    = includeLabel ? this.escapeXml(this.buildLabel(item)) : "";
      const tagWidth = Math.min(
        Math.max(80, width - box.x),
        Math.max(80, Math.round(label.length * (fontSize * 0.58) + 12))
      );
      const tagHeight = fontSize + 10;
      const tagY      = Math.max(0, box.y - tagHeight - 4);
      const textY     = tagY + fontSize + 1;

      return `
<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"
  fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
${includeLabel && label
  ? `<rect x="${box.x}" y="${tagY}" width="${tagWidth}" height="${tagHeight}" fill="${stroke}" rx="3"/>
<text x="${box.x + 4}" y="${textY}" font-size="${fontSize}" font-family="monospace" fill="white">${label}</text>`
  : ""}`;
    }).join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n${itemsSvg}\n</svg>`;
  }

  // ── normalização de coordenadas ─────────────────────────────────────────────

  /**
   * Converte Coordenadas (array ou objeto) → BoundingBox {x,y,w,h} bruto.
   * Os valores ainda estão na escala original (0-1000 ou pixels).
   */
  private coordsToBox(coords: Coordenadas): BoundingBox {
    if (Array.isArray(coords)) {
      return {
        x: Number(coords[0]), y: Number(coords[1]),
        w: Number(coords[2]), h: Number(coords[3]),
      };
    }
    return coords as BoundingBox;
  }

  /**
   * Converte um BoundingBox da escala do LLM para pixels reais da imagem,
   * depois aplica clamp para não ultrapassar as bordas.
   *
   * normalized-1000: x_px = round((x / 1000) * imageWidth)
   * pixels:          x_px = x  (sem conversão)
   */
  private denormalizeAndClamp(
    box:        BoundingBox,
    imgWidth:   number,
    imgHeight:  number,
    scale:      CoordScale,
  ): BoundingBox | null {
    let { x, y, w, h } = box;

    if ([x, y, w, h].some((n) => !Number.isFinite(n))) return null;

    if (scale === "normalized-1000") {
      x = Math.round((x / 1000) * imgWidth);
      y = Math.round((y / 1000) * imgHeight);
      w = Math.round((w / 1000) * imgWidth);
      h = Math.round((h / 1000) * imgHeight);
    }

    const safeX = this.clamp(x, 0, imgWidth);
    const safeY = this.clamp(y, 0, imgHeight);
    const safeW = this.clamp(w, 0, imgWidth  - safeX);
    const safeH = this.clamp(h, 0, imgHeight - safeY);

    return { x: safeX, y: safeY, w: safeW, h: safeH };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private buildLabel(item: UiElement): string {
    const parts: string[] = [];
    if (item.type) parts.push(`[${item.type}]`);
    if (item.id)   parts.push(item.id);
    if (item.text) parts.push(`- ${this.truncate(String(item.text), 40)}`);
    return parts.join(" ");
  }

  private parseBase64Image(base64OrDataUri: string): { buffer: Buffer; mimeType?: string } {
    if (!base64OrDataUri || typeof base64OrDataUri !== "string") {
      throw new Error("imageBase64 inválido.");
    }
    const match = base64OrDataUri.match(/^data:(.+?);base64,(.+)$/);
    if (match) return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
    return { buffer: Buffer.from(base64OrDataUri, "base64") };
  }

  private getMimeType(format: OutputFormat): string {
    switch (format) {
      case "jpeg": return "image/jpeg";
      case "webp": return "image/webp";
      case "png":
      default:     return "image/png";
    }
  }

  private truncate(value: string, max = 40): string {
    if (!value) return "";
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  }

  private escapeXml(value = ""): string {
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}
