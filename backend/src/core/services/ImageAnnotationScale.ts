// ImageAnnotation.ts
import sharp from "sharp";

type OutputFormat = "png" | "jpeg" | "webp";

/**
 * normalized-1000 → LLM usou coordenadas no intervalo 0–1000 (ex.: Gemini).
 * pixels          → LLM usou pixels absolutos; se forem de outra resolução,
 *                   passe llmBaseWidth / llmBaseHeight para reescalar.
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
  /** Pode chegar como array [x,y,w,h] OU objeto {x,y,w,h} */
  coordenadas:  Coordenadas;
  state?:       string;
  color?:       string;
  actions?:     string[];
  meta?:        Record<string, unknown>;
}

export interface RawResponsePart {
  text?: string;
}

export interface RawResponseCandidate {
  content?: {
    parts?: RawResponsePart[];
    role?:  string;
  };
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
  /** Array de elementos já parseados pelo servidor (opcional) */
  ui?: UiElement[];
}

export interface AnnotateImageParams {
  imageBase64:   string;
  analysis:      AnalysisInput;
  stroke?:       string;
  fill?:         string;
  outputFormat?: OutputFormat;
  includeLabel?: boolean;
  /**
   * Sistema de coordenadas usado pelo LLM.
   * - "normalized-1000" (padrão): valores entre 0–1000.
   * - "pixels": pixels absolutos. Se o LLM usou uma resolução diferente da
   *   imagem real, forneça também llmBaseWidth / llmBaseHeight.
   */
  coordScale?:   CoordScale;
  /** Largura em pixels que o LLM usou como referência ao gerar as coordenadas. */
  llmBaseWidth?: number;
  /** Altura em pixels que o LLM usou como referência ao gerar as coordenadas. */
  llmBaseHeight?: number;
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

export class LlmImageAnnotatorService {
  public async annotateFromAnalysis(
    params: AnnotateImageParams
  ): Promise<AnnotateImageResult> {
    const {
      imageBase64,
      analysis,
      stroke        = "#ff2d2d",
      fill          = "rgba(255,45,45,0.10)",
      outputFormat  = "png",
      includeLabel  = false,
      coordScale    = "normalized-1000",
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
      width:         meta.width,
      height:        meta.height,
      ui,
      stroke,
      fill,
      includeLabel,
      coordScale,
      llmBaseWidth:  params.llmBaseWidth,
      llmBaseHeight: params.llmBaseHeight,
    });

    let pipeline = image.composite([
      {
        input: Buffer.from(overlaySvg),
        top:   0,
        left:  0,
      },
    ]);

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

  // ── extração de elementos ───────────────────────────────────────────────────

  private extractUiElements(analysis: AnalysisInput): UiElement[] {
    // Prioridade 1: campo ui já parseado
    if (Array.isArray(analysis.ui) && analysis.ui.length > 0) {
      return analysis.ui.filter((item) => this.isValidUiElement(item));
    }

    // Prioridade 2: extrai do rawResponse.candidates[*].content.parts[*].text
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
        if (typeof part?.text === "string" && part.text.trim()) {
          return part.text;
        }
      }
    }
    return null;
  }

  private parseUiJsonText(text: string): unknown {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i,     "")
      .replace(/\s*```$/i,     "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      // Tenta extrair o primeiro array encontrado no texto
      const start = cleaned.indexOf("[");
      const end   = cleaned.lastIndexOf("]");
      if (start >= 0 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error("Não foi possível fazer parse do JSON em rawResponse.");
    }
  }

  /**
   * Valida elemento de UI aceitando coordenadas como ARRAY [x,y,w,h] ou OBJETO {x,y,w,h}.
   */
  private isValidUiElement(item: unknown): item is UiElement {
    if (!item || typeof item !== "object") return false;

    const el = item as UiElement;
    const c  = el.coordenadas;
    if (!c) return false;

    // Converte para objeto e valida
    const box = this.coordsToBox(c);
    return (
      this.isFiniteNumber(box.x) &&
      this.isFiniteNumber(box.y) &&
      this.isFiniteNumber(box.w) &&
      this.isFiniteNumber(box.h)
    );
  }

  // ── geração do SVG overlay ──────────────────────────────────────────────────

  private buildOverlaySvg(params: {
    width:          number;
    height:         number;
    ui:             UiElement[];
    stroke:         string;
    fill:           string;
    includeLabel:   boolean;
    coordScale:     CoordScale;
    llmBaseWidth?:  number;
    llmBaseHeight?: number;
  }): string {
    const {
      width, height, ui, stroke, fill, includeLabel,
      coordScale, llmBaseWidth, llmBaseHeight,
    } = params;

    const strokeWidth = Math.max(2, Math.round(Math.min(width, height) * 0.0035));
    const fontSize    = Math.max(12, Math.round(Math.min(width, height) * 0.018));

    const itemsSvg = ui
      .map((item) => {
        const raw = this.coordsToBox(item.coordenadas);
        const box = this.denormalizeAndClamp(
          raw,
          width,
          height,
          coordScale,
          llmBaseWidth,
          llmBaseHeight,
        );
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
<rect
  x="${box.x}" y="${box.y}"
  width="${box.w}" height="${box.h}"
  fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"
/>
${includeLabel && label
  ? `<rect x="${box.x}" y="${tagY}" width="${tagWidth}" height="${tagHeight}" fill="${stroke}" rx="3"/>
<text x="${box.x + 4}" y="${textY}" font-size="${fontSize}" font-family="monospace" fill="white">${label}</text>`
  : ""
}`;
      })
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
${itemsSvg}
</svg>`;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  /**
   * Converte Coordenadas (array OU objeto) → BoundingBox {x,y,w,h}.
   */
  private coordsToBox(coords: Coordenadas): BoundingBox {
    if (Array.isArray(coords)) {
      return {
        x: Number(coords[0]),
        y: Number(coords[1]),
        w: Number(coords[2]),
        h: Number(coords[3]),
      };
    }
    // Já é objeto {x,y,w,h}
    return coords as BoundingBox;
  }

  /**
   * Converte as coordenadas brutas do LLM para pixels da imagem real, aplicando:
   *   - "normalized-1000": divide por 1000 e multiplica pelo tamanho real.
   *   - "pixels" sem llmBase*: assume que os pixels já batem com a imagem real.
   *   - "pixels" com llmBase*: reescala dos pixels do LLM para o tamanho real.
   * Após a conversão, faz clamp para não extrapolar as bordas.
   */
  private denormalizeAndClamp(
    box:            BoundingBox,
    imgWidth:       number,
    imgHeight:      number,
    scale:          CoordScale,
    llmBaseWidth?:  number,
    llmBaseHeight?: number,
  ): BoundingBox | null {
    let { x, y, w, h } = box;

    if ([x, y, w, h].some((n) => !Number.isFinite(n))) return null;

    if (scale === "normalized-1000") {
      x = Math.round((x / 1000) * imgWidth);
      y = Math.round((y / 1000) * imgHeight);
      w = Math.round((w / 1000) * imgWidth);
      h = Math.round((h / 1000) * imgHeight);
    } else if (scale === "pixels" && llmBaseWidth && llmBaseHeight) {
      // Reescala dos pixels do LLM para o tamanho real da imagem
      const scaleX = imgWidth  / llmBaseWidth;
      const scaleY = imgHeight / llmBaseHeight;
      x = Math.round(x * scaleX);
      y = Math.round(y * scaleY);
      w = Math.round(w * scaleX);
      h = Math.round(h * scaleY);
    }
    // scale === "pixels" sem llmBase* → usa coordenadas como estão

    const safeX = this.clamp(x, 0, imgWidth);
    const safeY = this.clamp(y, 0, imgHeight);
    const safeW = this.clamp(w, 0, imgWidth  - safeX);
    const safeH = this.clamp(h, 0, imgHeight - safeY);

    return { x: safeX, y: safeY, w: safeW, h: safeH };
  }

  private buildLabel(item: UiElement): string {
    const parts: string[] = [];
    if (item.type) parts.push(`[${item.type}]`);
    if (item.id)   parts.push(item.id);
    if (item.text) parts.push(`- ${this.truncate(String(item.text), 40)}`);
    return parts.join(" ");
  }

  private parseBase64Image(base64OrDataUri: string): {
    buffer:    Buffer;
    mimeType?: string;
  } {
    if (!base64OrDataUri || typeof base64OrDataUri !== "string") {
      throw new Error("imageBase64 inválido.");
    }
    const match = base64OrDataUri.match(/^data:(.+?);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
    }
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

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  }

  private escapeXml(value = ""): string {
    return String(value)
      .replace(/&/g,  "&amp;")
      .replace(/</g,  "&lt;")
      .replace(/>/g,  "&gt;")
      .replace(/"/g,  "&quot;")
      .replace(/'/g,  "&#39;");
  }
}