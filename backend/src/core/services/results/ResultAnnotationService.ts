import fs from "fs";
import path from "path";
import {
  CoordScale,
  LlmImageAnnotatorService,
  UiElement,
} from "../ImageAnnotationScale";
import {
  readImageFileAsDataUrl,
  resolveImagePath,
} from "../final/resolveImagePath";
import { SavedResultPayload } from "./ResultWriter";

const PIXEL_PROMPT_VERSIONS = new Set([
  "v9",
  "v6pixels",
  "v6pixels_tall",
  "v6PixelsEn",
  "v5pixels",
  "v5pixelsold",
  "v1",
]);

/** Escala de coordenadas esperada para cada versão de prompt. */
export function inferCoordScaleForPromptVersion(
  version: string | undefined,
): CoordScale {
  if (!version) return "pixels";
  const v = version.trim();
  if (PIXEL_PROMPT_VERSIONS.has(v)) return "pixels";
  if (v.includes("pixel") && v !== "v3pixels") return "pixels";
  return "normalized-1000";
}

export function extractUiFromSavedPayload(payload: Record<string, unknown>): UiElement[] {
  if (Array.isArray(payload.ui) && payload.ui.length > 0) {
    return payload.ui as UiElement[];
  }

  const raw = payload.rawResponse;
  if (!raw || typeof raw !== "object") return [];

  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.ui) && obj.ui.length > 0) {
    return obj.ui as UiElement[];
  }

  const candidates = (obj as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(candidates)) return [];

  for (const candidate of candidates) {
    const parts = (candidate as { content?: { parts?: unknown[] } })?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const text = (part as { text?: string })?.text;
      if (!text?.trim()) continue;
      const parsed = parseUiJsonText(text);
      if (parsed.length) return parsed;
    }
  }

  return [];
}

function parseUiJsonText(text: string): UiElement[] {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as UiElement[];
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed as UiElement[];
      } catch {
        /* ignora */
      }
    }
  }
  return [];
}

export type AnnotationDirs = {
  baseDir: string;
  pixelsDir: string;
  scaledDir: string;
};

function filterUiWithCoordinates(ui: UiElement[]): UiElement[] {
  return ui.filter((el) => {
    const c = el.coordenadas;
    if (c == null) return false;
    if (Array.isArray(c)) {
      return c.length >= 4 && c.slice(0, 4).every((n) => Number.isFinite(Number(n)));
    }
    if (typeof c === "object") {
      const box = c as { x?: number; y?: number; w?: number; h?: number };
      return [box.x, box.y, box.w, box.h].every((n) => Number.isFinite(Number(n)));
    }
    return false;
  });
}

export class ResultAnnotationService {
  constructor(private readonly annotator = new LlmImageAnnotatorService()) {}

  /** Pasta ao lado do JSON: `<basename>/pixels/` e `<basename>/scaled/`. */
  resolveAnnotationBaseDir(jsonPath: string): string {
    return path.join(path.dirname(jsonPath), path.basename(jsonPath, ".json"));
  }

  async annotateSavedResult(
    jsonPath: string,
    imageBase64?: string,
    options?: { force?: boolean; coordScale?: CoordScale },
  ): Promise<AnnotationDirs | null> {
    const absoluteJson = path.resolve(jsonPath);
    if (!fs.existsSync(absoluteJson)) {
      throw new Error(`JSON não encontrado: ${absoluteJson}`);
    }

    const payload = JSON.parse(
      fs.readFileSync(absoluteJson, "utf-8"),
    ) as SavedResultPayload & Record<string, unknown>;

    const ui = filterUiWithCoordinates(extractUiFromSavedPayload(payload));
    if (!ui.length) return null;

    const base64 =
      imageBase64 ??
      (payload.sourceImage
        ? readImageFileAsDataUrl(
            resolveImagePath(String(payload.sourceImage)).absolutePath,
          )
        : undefined);

    if (!base64) {
      throw new Error(`Sem imagem para anotar: ${absoluteJson}`);
    }

    const coordScale =
      options?.coordScale ??
      inferCoordScaleForPromptVersion(
        payload.promptVersion as string | undefined,
      );

    const baseDir = this.resolveAnnotationBaseDir(absoluteJson);
    const pixelsDir = path.join(baseDir, "pixels");
    const scaledDir = path.join(baseDir, "scaled");

    if (
      !options?.force &&
      fs.existsSync(path.join(pixelsDir, "annotated.png")) &&
      fs.existsSync(path.join(scaledDir, "annotated.png"))
    ) {
      return { baseDir, pixelsDir, scaledDir };
    }

    fs.mkdirSync(pixelsDir, { recursive: true });
    fs.mkdirSync(scaledDir, { recursive: true });

    for (const withLabels of [false, true] as const) {
      const dual = await this.annotator.annotateDual({
        imageBase64: base64,
        analysis: { ui },
        coordScale,
        includeLabel: withLabels,
      });

      const fileName = withLabels ? "annotated_labels.png" : "annotated.png";
      fs.writeFileSync(path.join(pixelsDir, fileName), dual.pixels.buffer);
      fs.writeFileSync(path.join(scaledDir, fileName), dual.scaled.buffer);
    }

    return { baseDir, pixelsDir, scaledDir };
  }
}
