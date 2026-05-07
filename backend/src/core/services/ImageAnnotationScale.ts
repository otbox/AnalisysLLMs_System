// ImageAnnotationScale.ts
import sharp from "sharp";

type OutputFormat = "png" | "jpeg" | "webp";

/**
 * Coordinate system the LLM used when it returned bounding boxes.
 *
 * - "pixels"          : absolute pixel values matching the REAL image size.
 * - "normalized-1000" : values in [0, 1000] — normalised to a virtual canvas.
 */
export type CoordScale = "normalized-1000" | "pixels";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Coordenadas =
  | [number, number, number, number]
  | number[]
  | BoundingBox;

export interface UiElement {
  id?:          string;
  type?:        string;
  text?:        string | null;
  region?:      string;
  coordenadas:  Coordenadas;
  state?:       string;
  color?:       string;
  actions?:     string[];
  meta?:        Record<string, unknown>;
}

interface LibreNode {
  nome?:          string;
  classe?:        string;
  tipo_controle?: string;
  nivel?:         number;
  posicao?:       { x: number; y: number; w: number; h: number };
  visivel?:       boolean;
  habilitado?:    boolean;
  id_automacao?:  string;
  ignorado?:      boolean;
  filhos?:        LibreNode[];
  [key: string]:  unknown;
}

export interface RawResponsePart      { text?: string }
export interface RawResponseCandidate {
  content?:     { parts?: RawResponsePart[]; role?: string };
  finishReason?: string;
  index?:        number;
}

export interface AnalysisInput {
  profile?:           string;
  model?:             string;
  action?:            string;
  rationale?:         string;
  confidence?:        number;
  numberOfComponents?: number;
  rawResponse?: {
    candidates?:    RawResponseCandidate[];
    usageMetadata?: Record<string, unknown>;
    modelVersion?:  string;
    responseId?:    string;
  };
  ui?:         UiElement[];
  elements?:   UiElement[];
  components?: UiElement[];
  full?:       UiElement[];
  clean?:      UiElement[];
}

// ─── legacy normalisers ───────────────────────────────────────────────────────

interface EstruturaUIItem {
  is_dropdown: boolean; nome: string; classe: string; tag: string;
  tipo_controle: string; nivel: number;
  posicao: { x: number; y: number; w: number; h: number };
  visivel: boolean; habilitado: boolean; id_automacao: string;
  ignorado: boolean; screenshot?: string; filhos: EstruturaUIItem[];
}
interface EstruturaUIRoot { ui_structure: EstruturaUIItem[] }
interface OutputComponent {
  id: string; type: string; text: string | null;
  coordenadas: [number, number, number, number];
  actions: string[]; meta: Record<string, unknown>;
}
interface OutputRoot {
  action: string; rationale: string; numberOfComponents: number; confidence: number;
  rawResponse: {
    candidates: Array<{ content: { parts: Array<{ text?: string }> };
      finishReason: string; index: number }>;
    usageMetadata?: Record<string, unknown>; modelVersion?: string; responseId?: string;
  };
}

function isEstruturaUI(d: unknown): d is EstruturaUIRoot {
  return typeof d === "object" && d !== null && "ui_structure" in d &&
    Array.isArray((d as EstruturaUIRoot).ui_structure);
}
function isOutputRoot(d: unknown): d is OutputRoot {
  return typeof d === "object" && d !== null && "rawResponse" in d &&
    !!(d as any).rawResponse && Array.isArray((d as any).rawResponse.candidates);
}
function normalizeFromEstrutura(root: EstruturaUIRoot): UiElement[] {
  const results: UiElement[] = []; let counter = 0;
  function process(item: EstruturaUIItem) {
    if (item.ignorado || !item.posicao) return;
    const { x, y, w, h } = item.posicao;
    if (![x, y, w, h].every(Number.isFinite)) return;
    results.push({
      id: item.id_automacao || `${item.tag}_${item.tipo_controle}_${counter++}`,
      type: item.tipo_controle, text: item.nome || null, coordenadas: [x, y, w, h],
      meta: { tag: item.tag, classe: item.classe, is_dropdown: item.is_dropdown,
        nivel: item.nivel, screenshot: item.screenshot ?? null },
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
  try { arr = JSON.parse(rawText); }
  catch { const m = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) arr = JSON.parse(m[1].trim()); else return []; }
  if (!Array.isArray(arr)) return [];
  return (arr as OutputComponent[]).map((c) => ({
    id: c.id, type: c.type, text: c.text ?? null, coordenadas: c.coordenadas,
    actions: c.actions ?? [], meta: c.meta ?? {},
  }));
}
function normalizeUiSource(data: unknown): UiElement[] {
  if (isEstruturaUI(data)) return normalizeFromEstrutura(data);
  if (isOutputRoot(data))  return normalizeFromOutput(data);
  return [];
}

// ─── public types ─────────────────────────────────────────────────────────────

export interface AnnotateImageParams {
  imageBase64:   string;
  analysis:      AnalysisInput;
  stroke?:       string;
  fill?:         string;
  outputFormat?: OutputFormat;
  includeLabel?: boolean;
  coordScale?:   CoordScale;
}

export interface SingleAnnotateResult {
  buffer:        Buffer;
  base64:        string;
  dataUri:       string;
  mimeType:      string;
  width:         number;
  height:        number;
  elementsCount: number;
}
export type AnnotateImageResult = SingleAnnotateResult;

/**
 * Quad annotation result.
 *
 * pixels/
 *   A  — raw pixel coords drawn directly on the original image.
 *   B  — pixel coords normalised to 0-1000 (÷imgW/imgH) then back to px.
 * normalized/
 *   C  — JSON already in 0-1000, converted correctly (÷1000 × imgW/imgH).
 *   D  — JSON pixels treated as 0-1000 WITHOUT dividing first (bug-mode).
 */
export interface QuadAnnotateResult {
  pixels: {
    A: SingleAnnotateResult;   // pure pixels
    B: SingleAnnotateResult;   // pixels → norm → pixels
  };
  normalized: {
    C: SingleAnnotateResult;   // norm 0-1000 correct
    D: SingleAnnotateResult;   // pixels as norm (no divide)
  };
}

/** Legacy dual result kept for backward compat */
export interface DualAnnotateResult {
  pixels: SingleAnnotateResult;
  scaled: SingleAnnotateResult;
}

const DISPLAY_MAX_WIDTH  = 1920;
const DISPLAY_MAX_HEIGHT = 7200;
const DISPLAY_SCALE_CAP  = 1.0;

// ─── service ──────────────────────────────────────────────────────────────────

export class LlmImageAnnotatorService {

  // ── main public API ──────────────────────────────────────────────────────

  /**
   * Produces FOUR annotated images covering all coordinate interpretations.
   *
   * pixels/A  — coordenadas do JSON são pixels reais → desenha direto.
   * pixels/B  — mesmos pixels ÷ (imgW|imgH) → 0-1000 → converte de volta.
   * normalized/C — JSON já está em 0-1000 → converte para px corretamente.
   * normalized/D — JSON em pixels MAS tratado como 0-1000 sem dividir (bug).
   *
   * @param params.coordScale  Descreve o que o LLM REALMENTE gerou:
   *   - "pixels"          → A e B fazem sentido como referência.
   *   - "normalized-1000" → C e D fazem sentido como referência.
   *   Todas as 4 imagens são sempre produzidas para comparação visual.
   */
  async annotateQuad(
    params: AnnotateImageParams,
  ): Promise<QuadAnnotateResult> {
    const {
      imageBase64,
      analysis,
      stroke       = "#ff2d2d",
      fill         = "rgba(255,45,45,0.10)",
      outputFormat = "png",
      includeLabel = false,
    } = params;

    const { buffer: inputBuffer } = this.parseBase64Image(imageBase64);
    const meta = await sharp(inputBuffer).metadata();
    if (!meta.width || !meta.height)
      throw new Error("Could not determine image width/height.");

    const imgW = meta.width;
    const imgH = meta.height;

    const ui = this.extractUiElements(analysis);
    if (!ui.length)
      throw new Error("No UI elements found in analysis.");

    const renderOpts = { inputBuffer, imgW, imgH, ui, stroke, fill, includeLabel, outputFormat };

    // ── A: pixels → pixels (raw, sem conversão) ───────────────────────────
    const boxesA = this.boxesPixelsPure(ui, imgW, imgH);

    // ── B: pixels → norm 0-1000 → pixels (via divisão) ───────────────────
    const boxesB = this.boxesPixelsViaNorm(ui, imgW, imgH);

    // ── C: normalized-1000 → pixels (conversão correta) ──────────────────
    const boxesC = this.boxesNormCorrect(ui, imgW, imgH);

    // ── D: pixels tratado como 0-1000 sem dividir (bug intencional) ───────
    const boxesD = this.boxesNormRaw(ui, imgW, imgH);

    const [A, B, C, D] = await Promise.all([
      this.renderAnnotation({ ...renderOpts, boxes: boxesA }),
      this.renderAnnotation({ ...renderOpts, boxes: boxesB }),
      this.renderAnnotation({ ...renderOpts, boxes: boxesC }),
      this.renderAnnotation({ ...renderOpts, boxes: boxesD }),
    ]);

    return {
      pixels:     { A, B },
      normalized: { C, D },
    };
  }

  /**
   * Legacy dual API — kept for backward compat.
   * pixels  → mode A (raw pixel coords).
   * scaled  → mode A boxes re-fitted to display viewport.
   */
  async annotateDual(
    params: AnnotateImageParams,
  ): Promise<DualAnnotateResult> {
    const {
      imageBase64,
      analysis,
      stroke       = "#ff2d2d",
      fill         = "rgba(255,45,45,0.10)",
      outputFormat = "png",
      includeLabel = false,
      coordScale   = "pixels",
    } = params;

    const { buffer: inputBuffer } = this.parseBase64Image(imageBase64);
    const meta = await sharp(inputBuffer).metadata();
    if (!meta.width || !meta.height)
      throw new Error("Could not determine image width/height.");

    const imgW = meta.width;
    const imgH = meta.height;
    const ui   = this.extractUiElements(analysis);
    if (!ui.length)
      throw new Error("No UI elements found in analysis.");

    const absoluteBoxes = this.resolveAbsoluteBoxes(ui, coordScale, imgW, imgH);

    const pixelsResult = await this.renderAnnotation({
      inputBuffer, imgW, imgH, boxes: absoluteBoxes,
      ui, stroke, fill, includeLabel, outputFormat,
    });

    const scaleRatio  = this.computeDisplayScale(imgW, imgH);
    const displayW    = Math.round(imgW * scaleRatio);
    const displayH    = Math.round(imgH * scaleRatio);
    const scaledBuf   = await sharp(inputBuffer).resize(displayW, displayH, { fit: "fill" }).toBuffer();
    const scaledBoxes = absoluteBoxes.map((b) => ({
      x: Math.round(b.x * scaleRatio), y: Math.round(b.y * scaleRatio),
      w: Math.round(b.w * scaleRatio), h: Math.round(b.h * scaleRatio),
    }));
    const scaledResult = await this.renderAnnotation({
      inputBuffer: scaledBuf, imgW: displayW, imgH: displayH,
      boxes: scaledBoxes, ui, stroke, fill, includeLabel, outputFormat,
    });

    return { pixels: pixelsResult, scaled: scaledResult };
  }

  /** Legacy single-image API. */
  async annotateFromAnalysis(params: AnnotateImageParams): Promise<SingleAnnotateResult> {
    return (await this.annotateDual(params)).pixels;
  }

  // ── Box derivation modes ─────────────────────────────────────────────────

  /**
   * A — Pixels puros.
   * Coordenadas do JSON são pixels reais → apenas clamp.
   */
  private boxesPixelsPure(ui: UiElement[], imgW: number, imgH: number): BoundingBox[] {
    return ui.map((el) => {
      const { x, y, w, h } = this.coordsToBox(el.coordenadas);
      if (![x, y, w, h].every(Number.isFinite)) return { x: 0, y: 0, w: 0, h: 0 };
      return this.clampBox({ x, y, w, h }, imgW, imgH);
    });
  }

  /**
   * B — Pixels → normalizado → pixels (via divisão imgW/imgH).
   * Pega os pixels, normaliza para 0-1000 dividindo pelas dimensões da imagem,
   * depois converte de volta multiplicando. Deve produzir resultado idêntico ao A.
   * Se A ≠ B há perda de precisão por arredondamento.
   */
  private boxesPixelsViaNorm(ui: UiElement[], imgW: number, imgH: number): BoundingBox[] {
    return ui.map((el) => {
      const raw = this.coordsToBox(el.coordenadas);
      if (![raw.x, raw.y, raw.w, raw.h].every(Number.isFinite))
        return { x: 0, y: 0, w: 0, h: 0 };
      // passo 1: pixels → 0-1000
      const nx = (raw.x / imgW) * 1000;
      const ny = (raw.y / imgH) * 1000;
      const nw = (raw.w / imgW) * 1000;
      const nh = (raw.h / imgH) * 1000;
      // passo 2: 0-1000 → pixels
      // const px = (nx / 1000) * imgW;
      // const py = (ny / 1000) * imgH;
      // const pw = (nw / 1000) * imgW;
      // const ph = (nh / 1000) * imgH;
      return this.clampBox({ x: nx, y: ny, w: nw, h: nh }, imgW, imgH);
    });
  }

  /**
   * C — normalized-1000 correto → pixels.
   * Assume que o JSON já está em 0-1000 e converte usando imgW/imgH.
   * Esse é o caminho correto para LLMs que retornam coordenadas normalizadas.
   */
  private boxesNormCorrect(ui: UiElement[], imgW: number, imgH: number): BoundingBox[] {
    return ui.map((el) => {
      const { x, y, w, h } = this.coordsToBox(el.coordenadas);
      if (![x, y, w, h].every(Number.isFinite)) return { x: 0, y: 0, w: 0, h: 0 };
      const px = (x / 1000) * imgW;
      const py = (y / 1000) * imgH;
      const pw = (w / 1000) * imgW;
      const ph = (h / 1000) * imgH;
      return this.clampBox({ x: px, y: py, w: pw, h: ph }, imgW, imgH);
    });
  }

  /**
   * D — Pixels tratados como normalized-1000 SEM dividir (modo bug).
   * O JSON tem pixels reais mas o anotador os multiplica por imgW/imgH
   * como se fossem 0-1000. Produz caixas gigantescas / fora da imagem.
   * Útil para visualizar o que acontecia antes da correção de coordScale.
   */
  private boxesNormRaw(ui: UiElement[], imgW: number, imgH: number): BoundingBox[] {
    return ui.map((el) => {
      const { x, y, w, h } = this.coordsToBox(el.coordenadas);
      if (![x, y, w, h].every(Number.isFinite)) return { x: 0, y: 0, w: 0, h: 0 };
      // multiplica direto SEM dividir por 1000 primeiro
      // const px = (x / 1000) * imgW;
      // const py = (y / 1000) * imgH;
      // const pw = (w / 1000) * imgW;
      // const ph = (h / 1000) * imgH;
      return this.clampBox({ x, y, w, h }, imgW, imgH);
      // return this.clampBox({ x: px, y: py, w: pw, h: ph }, imgW, imgH);
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private clampBox(b: BoundingBox, imgW: number, imgH: number): BoundingBox {
    const x = this.clamp(Math.round(b.x), 0, imgW);
    const y = this.clamp(Math.round(b.y), 0, imgH);
    const w = this.clamp(Math.round(b.w), 0, imgW - x);
    const h = this.clamp(Math.round(b.h), 0, imgH - y);
    return { x, y, w, h };
  }

  /** Legacy resolver kept for annotateDual. */
  private resolveAbsoluteBoxes(
    ui:         UiElement[],
    coordScale: CoordScale,
    imgW:       number,
    imgH:       number,
  ): BoundingBox[] {
    return coordScale === "normalized-1000"
      ? this.boxesNormCorrect(ui, imgW, imgH)
      : this.boxesPixelsPure(ui, imgW, imgH);
  }

  private computeDisplayScale(imgW: number, imgH: number): number {
    return Math.min(DISPLAY_SCALE_CAP, DISPLAY_MAX_WIDTH / imgW, DISPLAY_MAX_HEIGHT / imgH);
  }

  private async renderAnnotation(opts: {
    inputBuffer:  Buffer;
    imgW:         number;
    imgH:         number;
    boxes:        BoundingBox[];
    ui:           UiElement[];
    stroke:       string;
    fill:         string;
    includeLabel: boolean;
    outputFormat: OutputFormat;
  }): Promise<SingleAnnotateResult> {
    const { inputBuffer, imgW, imgH, boxes, ui, stroke, fill, includeLabel, outputFormat } = opts;
    const overlaySvg = this.buildOverlaySvg({ width: imgW, height: imgH, boxes, ui, stroke, fill, includeLabel });
    let pipeline = sharp(inputBuffer).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);
    switch (outputFormat) {
      case "jpeg": pipeline = pipeline.jpeg({ quality: 90 }); break;
      case "webp": pipeline = pipeline.webp({ quality: 90 }); break;
      default:     pipeline = pipeline.png(); break;
    }
    const outputBuffer = await pipeline.toBuffer();
    const mimeType     = this.getMimeType(outputFormat);
    const base64       = outputBuffer.toString("base64");
    return {
      buffer: outputBuffer, base64,
      dataUri: `data:${mimeType};base64,${base64}`,
      mimeType, width: imgW, height: imgH, elementsCount: ui.length,
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
    const any = analysis as any;
    if (any.ui_structure && typeof any.ui_structure === "object") {
      const rootPos = any.ui_structure?.posicao;
      const flatted = this.flattenLibreUi(any.ui_structure as LibreNode, {
        mode: "pixels", baseW: rootPos?.w ?? 1000, baseH: rootPos?.h ?? 1000,
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
      for (const part of parts)
        if (typeof part?.text === "string" && part.text.trim()) return part.text;
    }
    return null;
  }

  private parseUiJsonText(text: string): unknown {
    const cleaned = text.trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      const obj = JSON.parse(cleaned);
      if (Array.isArray(obj)) return obj;
      if (obj && typeof obj === "object") {
        for (const key of ["ui", "elements", "components", "full", "clean"])
          if (Array.isArray((obj as any)[key])) return (obj as any)[key];
        return obj;
      }
    } catch {
      const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
      if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
      throw new Error("Could not parse JSON from rawResponse.");
    }
  }

  private isValidUiElement(item: unknown): item is UiElement {
    if (!item || typeof item !== "object") return false;
    const box = this.coordsToBox((item as UiElement).coordenadas);
    return this.isFiniteNumber(box.x) && this.isFiniteNumber(box.y) &&
      this.isFiniteNumber(box.w) && this.isFiniteNumber(box.h);
  }

  // ── SVG overlay ───────────────────────────────────────────────────────────

  private buildOverlaySvg(params: {
    width: number; height: number; boxes: BoundingBox[];
    ui: UiElement[]; stroke: string; fill: string; includeLabel: boolean;
  }): string {
    const { width, height, boxes, ui, stroke, fill, includeLabel } = params;
    const strokeWidth = Math.max(2, Math.round(Math.min(width, height) * 0.0035));
    const fontSize    = Math.max(12, Math.round(Math.min(width, height) * 0.018));
    const itemsSvg = boxes.map((box, i) => {
      if (!box || box.w <= 0 || box.h <= 0) return "";
      const item      = ui[i];
      const label     = includeLabel ? this.escapeXml(this.buildLabel(item)) : "";
      const tagWidth  = includeLabel
        ? Math.min(Math.max(80, width - box.x), Math.max(80, Math.round(label.length * (fontSize * 0.58) + 12)))
        : 0;
      const tagHeight = includeLabel ? fontSize + 10 : 0;
      const tagY      = includeLabel ? Math.max(0, box.y - tagHeight - 4) : 0;
      const textY     = tagY + fontSize + 1;
      return `<g>
  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"
    fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="4" ry="4" />
  ${includeLabel && label
    ? `<rect x="${box.x}" y="${tagY}" width="${tagWidth}" height="${tagHeight}" fill="${stroke}" rx="4" ry="4" />
  <text x="${box.x + 8}" y="${textY}" font-size="${fontSize}" fill="#ffffff"
    font-family="system-ui,-apple-system,sans-serif">${label}</text>`
    : ""}
</g>`;
    }).join("");
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${itemsSvg}</svg>`;
  }

  // ── coord / misc helpers ──────────────────────────────────────────────────

  private coordsToBox(coords: Coordenadas): BoundingBox {
    if (Array.isArray(coords))
      return { x: Number(coords[0]), y: Number(coords[1]), w: Number(coords[2]), h: Number(coords[3]) };
    return coords as BoundingBox;
  }

  private flattenLibreUi(
    root: LibreNode | null | undefined,
    opts?: { mode?: "pixels" | "normalized-1000"; baseW?: number; baseH?: number },
  ): UiElement[] {
    if (!root) return [];
    const mode = opts?.mode ?? "pixels", baseW = opts?.baseW ?? 1000, baseH = opts?.baseH ?? 1000;
    const result: UiElement[] = [];
    const norm = (x: number, y: number, w: number, h: number) =>
      mode === "pixels"
        ? [x, y, w, h] as [number, number, number, number]
        : [(x / baseW) * 1000, (y / baseH) * 1000, (w / baseW) * 1000, (h / baseH) * 1000] as [number, number, number, number];
    const visit = (node: LibreNode) => {
      const pos = node.posicao, visible = node.visivel !== false;
      if (pos && typeof pos.x === "number" && typeof pos.y === "number" &&
        typeof pos.w === "number" && typeof pos.h === "number" && visible && pos.w > 0 && pos.h > 0) {
        const [nx, ny, nw, nh] = norm(pos.x, pos.y, pos.w, pos.h);
        const el: UiElement = {
          id: node.id_automacao || node.nome || undefined,
          type: node.tipo_controle || node.classe || undefined,
          text: node.nome ?? null, coordenadas: [nx, ny, nw, nh],
          meta: { classe: node.classe, nivel: node.nivel, ignorado: node.ignorado },
        };
        if (this.isValidUiElement(el)) result.push(el);
      }
      if (Array.isArray(node.filhos)) node.filhos.forEach(visit);
    };
    visit(root);
    return result;
  }

  private parseBase64Image(base64OrDataUri: string): { buffer: Buffer; mimeType?: string } {
    if (!base64OrDataUri || typeof base64OrDataUri !== "string")
      throw new Error("Invalid imageBase64.");
    const match = base64OrDataUri.match(/^data:(.+?);base64,(.+)$/);
    if (match) return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
    return { buffer: Buffer.from(base64OrDataUri, "base64") };
  }

  private getMimeType(f: OutputFormat): string {
    return f === "jpeg" ? "image/jpeg" : f === "webp" ? "image/webp" : "image/png";
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
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}
