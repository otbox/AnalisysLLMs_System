// ImageAnnotationScale.ts
import sharp from "sharp";

type OutputFormat = "png" | "jpeg" | "webp";

/**
 * Coordinate system used by the LLM when it returned bounding boxes.
 *
 * - "pixels"          : absolute pixel values that match the real image dimensions.
 * - "normalized-1000" : values in [0, 1000] — the LLM normalised its output
 *                       to a 1000×1000 virtual canvas.
 *
 * The SYSTEM (not the LLM) is now responsible for all scaling.
 * Two annotated images are always produced per call:
 *   • pixels   — boxes drawn on the real image using the absolute pixel coords.
 *   • scaled   — boxes drawn after re-fitting them to a display-safe viewport
 *               (max 1920 × 1080 by default) while preserving the aspect-ratio.
 */
export type CoordScale = "normalized-1000" | "pixels";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Accepts both array [x,y,w,h] and object {x,y,w,h}. */
export type Coordenadas =
  | [number, number, number, number]
  | number[]
  | BoundingBox;

export interface UiElement {
  id?: string;
  type?: string;
  text?: string | null;
  region?: string;
  /** Can arrive as array [x,y,w,h] OR object {x,y,w,h}. */
  coordenadas: Coordenadas;
  state?: string;
  color?: string;
  actions?: string[];
  meta?: Record<string, unknown>;
}

interface LibreNode {
  nome?: string;
  classe?: string;
  tipo_controle?: string;
  nivel?: number;
  posicao?: { x: number; y: number; w: number; h: number };
  visivel?: boolean;
  habilitado?: boolean;
  id_automacao?: string;
  ignorado?: boolean;
  filhos?: LibreNode[];
  [key: string]: unknown;
}

// ── Raw response types ────────────────────────────────────────────────────────

export interface RawResponsePart {
  text?: string;
}

export interface RawResponseCandidate {
  content?: {
    parts?: RawResponsePart[];
    role?: string;
  };
  finishReason?: string;
  index?: number;
}

export interface AnalysisInput {
  profile?: string;
  model?: string;
  action?: string;
  rationale?: string;
  confidence?: number;
  numberOfComponents?: number;
  rawResponse?: {
    candidates?: RawResponseCandidate[];
    usageMetadata?: Record<string, unknown>;
    modelVersion?: string;
    responseId?: string;
  };
  ui?: UiElement[];
  elements?: UiElement[];
  components?: UiElement[];
  full?: UiElement[];
  clean?: UiElement[];
}

// ── Legacy raw-format normalisers ─────────────────────────────────────────────

interface EstruturaUIItem {
  is_dropdown: boolean;
  nome: string;
  classe: string;
  tag: string;
  tipo_controle: string;
  nivel: number;
  posicao: { x: number; y: number; w: number; h: number };
  visivel: boolean;
  habilitado: boolean;
  id_automacao: string;
  ignorado: boolean;
  screenshot?: string;
  filhos: EstruturaUIItem[];
}

interface EstruturaUIRoot {
  ui_structure: EstruturaUIItem[];
}

interface OutputComponent {
  id: string;
  type: string;
  text: string | null;
  coordenadas: [number, number, number, number];
  actions: string[];
  meta: Record<string, unknown>;
}

interface OutputRoot {
  action: string;
  rationale: string;
  numberOfComponents: number;
  confidence: number;
  rawResponse: {
    candidates: Array<{
      content: { parts: Array<{ text?: string }> };
      finishReason: string;
      index: number;
    }>;
    usageMetadata?: Record<string, unknown>;
    modelVersion?: string;
    responseId?: string;
  };
}

function isEstruturaUI(data: unknown): data is EstruturaUIRoot {
  return (
    typeof data === "object" &&
    data !== null &&
    "ui_structure" in data &&
    Array.isArray((data as EstruturaUIRoot).ui_structure)
  );
}

function isOutputRoot(data: unknown): data is OutputRoot {
  return (
    typeof data === "object" &&
    data !== null &&
    "rawResponse" in data &&
    !!(data as any).rawResponse &&
    Array.isArray((data as any).rawResponse.candidates)
  );
}

function normalizeFromEstrutura(root: EstruturaUIRoot): UiElement[] {
  const results: UiElement[] = [];
  let counter = 0;

  function process(item: EstruturaUIItem) {
    if (item.ignorado || !item.posicao) return;
    const { x, y, w, h } = item.posicao;
    if (![x, y, w, h].every(Number.isFinite)) return;

    results.push({
      id: item.id_automacao || `${item.tag}_${item.tipo_controle}_${counter++}`,
      type: item.tipo_controle,
      text: item.nome || null,
      coordenadas: [x, y, w, h],
      meta: {
        tag: item.tag,
        classe: item.classe,
        is_dropdown: item.is_dropdown,
        nivel: item.nivel,
        screenshot: item.screenshot ?? null,
      },
    });

    if (Array.isArray(item.filhos)) item.filhos.forEach(process);
  }

  if (Array.isArray(root.ui_structure)) root.ui_structure.forEach(process);
  return results;
}

function normalizeFromOutput(root: OutputRoot): UiElement[] {
  const rawText = root.rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!rawText.trim()) return [];

  let arr: unknown;
  try {
    arr = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) arr = JSON.parse(match[1].trim());
    else return [];
  }

  if (!Array.isArray(arr)) return [];
  return (arr as OutputComponent[]).map((c) => ({
    id: c.id,
    type: c.type,
    text: c.text ?? null,
    coordenadas: c.coordenadas,
    actions: c.actions ?? [],
    meta: c.meta ?? {},
  }));
}

function normalizeUiSource(data: unknown): UiElement[] {
  if (isEstruturaUI(data)) return normalizeFromEstrutura(data);
  if (isOutputRoot(data)) return normalizeFromOutput(data);
  return [];
}

// ── Annotation params & result ────────────────────────────────────────────────

export interface AnnotateImageParams {
  imageBase64: string;
  analysis: AnalysisInput;
  stroke?: string;
  fill?: string;
  outputFormat?: OutputFormat;
  includeLabel?: boolean;
  /**
   * Coordinate system the LLM used.
   * - "pixels"          : absolute pixel coordinates matching the real image.
   * - "normalized-1000" : values in [0, 1000].
   *
   * Scaling to fit the display viewport is always handled by the system.
   */
  coordScale?: CoordScale;
}

/**
 * Result of a DUAL annotation pass.
 * `pixels`  — annotations rendered on the original image dimensions.
 * `scaled`  — annotations rendered after down-scaling to the display viewport.
 */
export interface DualAnnotateResult {
  pixels: SingleAnnotateResult;
  scaled: SingleAnnotateResult;
}

export interface SingleAnnotateResult {
  buffer: Buffer;
  base64: string;
  dataUri: string;
  mimeType: string;
  width: number;
  height: number;
  elementsCount: number;
}

// Keep the old name as an alias so existing callers don't break.
export type AnnotateImageResult = SingleAnnotateResult;

/**
 * Maximum display viewport dimensions used when generating the `scaled` image.
 * Images taller/wider than this are proportionally down-scaled.
 * Supports very tall screenshots (e.g. 1920 × 7200).
 */
const DISPLAY_MAX_WIDTH  = 1920;
const DISPLAY_MAX_HEIGHT = 7200; // generous upper-bound; real cap is the ratio
const DISPLAY_SCALE_CAP  = 1.0;  // never up-scale — only shrink

// ── Main service ──────────────────────────────────────────────────────────────

export class LlmImageAnnotatorService {
  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Produces TWO annotated images in a single call:
   *   - `pixels` : original resolution with absolute-pixel boxes.
   *   - `scaled` : display-safe version (≤ DISPLAY_MAX_WIDTH × DISPLAY_MAX_HEIGHT).
   *
   * The `coordScale` param describes how the LLM generated its coordinates.
   * The system handles ALL scaling from there.
   */
  async annotateDual(
    params: AnnotateImageParams
  ): Promise<DualAnnotateResult> {
    const {
      imageBase64,
      analysis,
      stroke        = "#ff2d2d",
      fill          = "rgba(255,45,45,0.10)",
      outputFormat  = "png",
      includeLabel  = false,
      coordScale    = "pixels",
    } = params;

    const { buffer: inputBuffer } = this.parseBase64Image(imageBase64);
    const meta = await sharp(inputBuffer).metadata();

    if (!meta.width || !meta.height) {
      throw new Error("Could not determine image width/height.");
    }

    const imgW = meta.width;
    const imgH = meta.height;

    const ui = this.extractUiElements(analysis);
    if (!ui.length) {
      throw new Error("No UI elements found in analysis.");
    }

    // ── Resolve absolute-pixel boxes ────────────────────────────────────────
    // The LLM may have used normalised-1000 or absolute pixels.
    // Either way we convert to REAL image pixels here (system responsibility).
    const absoluteBoxes = this.resolveAbsoluteBoxes(ui, coordScale, imgW, imgH);

    // ── Pixels image (original resolution) ──────────────────────────────────
    const pixelsResult = await this.renderAnnotation({
      inputBuffer,
      imgW,
      imgH,
      boxes:        absoluteBoxes,
      ui,
      stroke,
      fill,
      includeLabel,
      outputFormat,
    });

    // ── Scaled image (display viewport) ─────────────────────────────────────
    const scaleRatio   = this.computeDisplayScale(imgW, imgH);
    const displayW     = Math.round(imgW * scaleRatio);
    const displayH     = Math.round(imgH * scaleRatio);

    // Re-scale image buffer
    const scaledBuffer = await sharp(inputBuffer)
      .resize(displayW, displayH, { fit: "fill" })
      .toBuffer();

    // Re-scale boxes proportionally
    const scaledBoxes  = absoluteBoxes.map((b) => ({
      x: Math.round(b.x * scaleRatio),
      y: Math.round(b.y * scaleRatio),
      w: Math.round(b.w * scaleRatio),
      h: Math.round(b.h * scaleRatio),
    }));

    const scaledResult = await this.renderAnnotation({
      inputBuffer: scaledBuffer,
      imgW:        displayW,
      imgH:        displayH,
      boxes:       scaledBoxes,
      ui,
      stroke,
      fill,
      includeLabel,
      outputFormat,
    });

    return { pixels: pixelsResult, scaled: scaledResult };
  }

  /**
   * Legacy single-image API — kept for backward compatibility.
   * Internally calls `annotateDual` and returns only the `pixels` result.
   */
  async annotateFromAnalysis(
    params: AnnotateImageParams
  ): Promise<SingleAnnotateResult> {
    const dual = await this.annotateDual(params);
    return dual.pixels;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Convert LLM coordinates → absolute pixel boxes on the REAL image.
   *
   * - "normalized-1000" : multiply by (imgW/1000) and (imgH/1000).
   * - "pixels"          : use as-is (clamp only).
   */
  private resolveAbsoluteBoxes(
    ui:         UiElement[],
    coordScale: CoordScale,
    imgW:       number,
    imgH:       number,
  ): BoundingBox[] {
    return ui.map((el) => {
      const raw = this.coordsToBox(el.coordenadas);
      let { x, y, w, h } = raw;

      if (![x, y, w, h].every(Number.isFinite)) {
        return { x: 0, y: 0, w: 0, h: 0 };
      }

      if (coordScale === "normalized-1000") {
        x = (x / 1000) * imgW;
        y = (y / 1000) * imgH;
        w = (w / 1000) * imgW;
        h = (h / 1000) * imgH;
      }
      // "pixels" — no conversion needed

      // Clamp to image boundaries
      const sx = this.clamp(Math.round(x), 0, imgW);
      const sy = this.clamp(Math.round(y), 0, imgH);
      const sw = this.clamp(Math.round(w), 0, imgW - sx);
      const sh = this.clamp(Math.round(h), 0, imgH - sy);

      return { x: sx, y: sy, w: sw, h: sh };
    });
  }

  /**
   * Compute the uniform scale factor to fit the image inside the display
   * viewport without up-scaling.
   */
  private computeDisplayScale(imgW: number, imgH: number): number {
    const scaleByW = DISPLAY_MAX_WIDTH  / imgW;
    const scaleByH = DISPLAY_MAX_HEIGHT / imgH;
    return Math.min(DISPLAY_SCALE_CAP, scaleByW, scaleByH);
  }

  /**
   * Render a single annotated image given pre-computed absolute boxes.
   */
  private async renderAnnotation(opts: {
    inputBuffer: Buffer;
    imgW:        number;
    imgH:        number;
    boxes:       BoundingBox[];
    ui:          UiElement[];
    stroke:      string;
    fill:        string;
    includeLabel: boolean;
    outputFormat: OutputFormat;
  }): Promise<SingleAnnotateResult> {
    const { inputBuffer, imgW, imgH, boxes, ui, stroke, fill, includeLabel, outputFormat } = opts;

    const overlaySvg = this.buildOverlaySvg({
      width: imgW,
      height: imgH,
      boxes,
      ui,
      stroke,
      fill,
      includeLabel,
    });

    let pipeline = sharp(inputBuffer).composite([
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
    ]);

    switch (outputFormat) {
      case "jpeg": pipeline = pipeline.jpeg({ quality: 90 }); break;
      case "webp": pipeline = pipeline.webp({ quality: 90 }); break;
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
      width:         imgW,
      height:        imgH,
      elementsCount: ui.length,
    };
  }

  // ── UI element extraction ─────────────────────────────────────────────────

  private extractUiElements(analysis: AnalysisInput): UiElement[] {
    if (Array.isArray(analysis.ui) && analysis.ui.length > 0)
      return analysis.ui.filter((i) => this.isValidUiElement(i));

    for (const key of ["elements", "components", "full", "clean"] as const) {
      const arr = analysis[key];
      if (Array.isArray(arr) && arr.length > 0)
        return (arr as UiElement[]).filter((i) => this.isValidUiElement(i));
    }

    const anyAnalysis = analysis as any;
    if (anyAnalysis.ui_structure && typeof anyAnalysis.ui_structure === "object") {
      const rootPos = anyAnalysis.ui_structure?.posicao;
      const flatted = this.flattenLibreUi(anyAnalysis.ui_structure as LibreNode, {
        mode:  "pixels",
        baseW: rootPos?.w ?? 1000,
        baseH: rootPos?.h ?? 1000,
      });
      if (flatted.length > 0) return flatted.filter((i) => this.isValidUiElement(i));
    }

    const normalized = normalizeUiSource(analysis as unknown);
    if (normalized.length > 0) return normalized.filter((i) => this.isValidUiElement(i));

    const rawText = this.extractTextFromRawResponse(analysis);
    if (!rawText) return [];

    const parsed = this.parseUiJsonText(rawText);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter((i) => this.isValidUiElement(i)) as UiElement[];
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
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      const obj = JSON.parse(cleaned);
      if (Array.isArray(obj)) return obj;
      if (obj && typeof obj === "object") {
        for (const key of ["ui", "elements", "components", "full", "clean"]) {
          if (Array.isArray((obj as any)[key])) return (obj as any)[key];
        }
        return obj;
      }
    } catch {
      const start = cleaned.indexOf("[");
      const end   = cleaned.lastIndexOf("]");
      if (start >= 0 && end > start)
        return JSON.parse(cleaned.slice(start, end + 1));
      throw new Error("Could not parse JSON from rawResponse.");
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

  // ── SVG overlay ───────────────────────────────────────────────────────────

  private buildOverlaySvg(params: {
    width:        number;
    height:       number;
    boxes:        BoundingBox[];
    ui:           UiElement[];
    stroke:       string;
    fill:         string;
    includeLabel: boolean;
  }): string {
    const { width, height, boxes, ui, stroke, fill, includeLabel } = params;

    const strokeWidth = Math.max(2, Math.round(Math.min(width, height) * 0.0035));
    const fontSize    = Math.max(12, Math.round(Math.min(width, height) * 0.018));

    const itemsSvg = boxes
      .map((box, i) => {
        if (!box || box.w <= 0 || box.h <= 0) return "";
        const item  = ui[i];
        const label = includeLabel ? this.escapeXml(this.buildLabel(item)) : "";

        const tagWidth = includeLabel
          ? Math.min(
              Math.max(80, width - box.x),
              Math.max(80, Math.round(label.length * (fontSize * 0.58) + 12))
            )
          : 0;
        const tagHeight = includeLabel ? fontSize + 10 : 0;
        const tagY      = includeLabel ? Math.max(0, box.y - tagHeight - 4) : 0;
        const textY     = tagY + fontSize + 1;

        return `
<g>
  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"
    fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="4" ry="4" />
  ${
    includeLabel && label
      ? `<rect x="${box.x}" y="${tagY}" width="${tagWidth}" height="${tagHeight}"
      fill="${stroke}" rx="4" ry="4" />
  <text x="${box.x + 8}" y="${textY}" font-size="${fontSize}" fill="#ffffff"
      font-family="system-ui, -apple-system, sans-serif">${label}</text>`
      : ""
  }
</g>`;
      })
      .join("");

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${itemsSvg}</svg>`;
  }

  // ── Coordinate utilities ──────────────────────────────────────────────────

  private coordsToBox(coords: Coordenadas): BoundingBox {
    if (Array.isArray(coords)) {
      return { x: Number(coords[0]), y: Number(coords[1]), w: Number(coords[2]), h: Number(coords[3]) };
    }
    return coords as BoundingBox;
  }

  private flattenLibreUi(
    root: LibreNode | null | undefined,
    opts?: { mode?: "pixels" | "normalized-1000"; baseW?: number; baseH?: number }
  ): UiElement[] {
    if (!root) return [];
    const mode  = opts?.mode  ?? "pixels";
    const baseW = opts?.baseW ?? 1000;
    const baseH = opts?.baseH ?? 1000;
    const result: UiElement[] = [];

    const norm = (x: number, y: number, w: number, h: number) =>
      mode === "pixels"
        ? [x, y, w, h] as [number, number, number, number]
        : [(x / baseW) * 1000, (y / baseH) * 1000, (w / baseW) * 1000, (h / baseH) * 1000] as [number, number, number, number];

    const visit = (node: LibreNode) => {
      const pos     = node.posicao;
      const visible = node.visivel !== false;
      if (
        pos &&
        typeof pos.x === "number" && typeof pos.y === "number" &&
        typeof pos.w === "number" && typeof pos.h === "number" &&
        visible && pos.w > 0 && pos.h > 0
      ) {
        const [nx, ny, nw, nh] = norm(pos.x, pos.y, pos.w, pos.h);
        const el: UiElement = {
          id:          node.id_automacao || node.nome || undefined,
          type:        node.tipo_controle || node.classe || undefined,
          text:        node.nome ?? null,
          coordenadas: [nx, ny, nw, nh],
          meta: { classe: node.classe, nivel: node.nivel, ignorado: node.ignorado },
        };
        if (this.isValidUiElement(el)) result.push(el);
      }
      if (Array.isArray(node.filhos)) node.filhos.forEach(visit);
    };

    visit(root);
    return result;
  }

  // ── Misc helpers ──────────────────────────────────────────────────────────

  private parseBase64Image(base64OrDataUri: string): { buffer: Buffer; mimeType?: string } {
    if (!base64OrDataUri || typeof base64OrDataUri !== "string")
      throw new Error("Invalid imageBase64.");
    const match = base64OrDataUri.match(/^data:(.+?);base64,(.+)$/);
    if (match) return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
    return { buffer: Buffer.from(base64OrDataUri, "base64") };
  }

  private getMimeType(format: OutputFormat): string {
    switch (format) {
      case "jpeg": return "image/jpeg";
      case "webp": return "image/webp";
      default:     return "image/png";
    }
  }

  private buildLabel(item: UiElement): string {
    const parts: string[] = [];
    if (item.type) parts.push(`[${item.type}]`);
    if (item.id)   parts.push(item.id);
    if (item.text) parts.push(`- ${this.truncate(String(item.text), 40)}`);
    return parts.join(" ");
  }

  private truncate(value: string, max = 40): string {
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
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
