// LlmImageAnnotatorService.ts
import sharp from "sharp";

type OutputFormat = "png" | "jpeg" | "webp";

export interface BoundingBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface UiElement {
    id?: string;
    type?: string;
    text?: string;
    region?: string;
    coordenadas: BoundingBox;
    state?: string;
    actions?: string[];
    meta?: Record<string, unknown>;
}

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
    rawResponse?: {
        candidates?: RawResponseCandidate[];
        usageMetadata?: Record<string, unknown>;
        modelVersion?: string;
        responseId?: string;
    };
    ui?: UiElement[];
}

export interface AnnotateImageParams {
    imageBase64: string;
    analysis: AnalysisInput;
    stroke?: string;
    fill?: string;
    outputFormat?: OutputFormat;
    includeLabel?: boolean;
}

export interface AnnotateImageResult {
    buffer: Buffer;
    base64: string;
    dataUri: string;
    mimeType: string;
    width: number;
    height: number;
    elementsCount: number;
}

export class LlmImageAnnotatorService {
    public async annotateFromAnalysis(
        params: AnnotateImageParams
    ): Promise<AnnotateImageResult> {
        const {
            imageBase64,
            analysis,
            stroke = "#ff2d2d",
            fill = "rgba(255,45,45,0.10)",
            outputFormat = "png",
            includeLabel = false,
        } = params;

        const { buffer: inputBuffer } = this.parseBase64Image(imageBase64);

        const image = sharp(inputBuffer);
        const meta = await image.metadata();

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
        });

        let pipeline = image.composite([
            {
                input: Buffer.from(overlaySvg),
                top: 0,
                left: 0,
            },
        ]);

        switch (outputFormat) {
            case "jpeg":
                pipeline = pipeline.jpeg({ quality: 90 });
                break;
            case "webp":
                pipeline = pipeline.webp({ quality: 90 });
                break;
            case "png":
            default:
                pipeline = pipeline.png();
                break;
        }

        const outputBuffer = await pipeline.toBuffer();
        const mimeType = this.getMimeType(outputFormat);
        const base64 = outputBuffer.toString("base64");

        return {
            buffer: outputBuffer,
            base64,
            dataUri: `data:${mimeType};base64,${base64}`,
            mimeType,
            width: meta.width,
            height: meta.height,
            elementsCount: ui.length,
        };
    }

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
                if (typeof part?.text === "string" && part.text.trim()) {
                    return part.text;
                }
            }
        }

        return null;
    }

    private parseUiJsonText(text: string): unknown {
        const trimmed = text.trim();

        const cleaned = trimmed
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        try {
            return JSON.parse(cleaned);
        } catch {
            const start = cleaned.indexOf("[");
            const end = cleaned.lastIndexOf("]");
            if (start >= 0 && end > start) {
                const possibleArray = cleaned.slice(start, end + 1);
                return JSON.parse(possibleArray);
            }
            throw new Error("Não foi possível fazer parse do JSON em rawResponse.");
        }
    }

    private isValidUiElement(item: unknown): item is UiElement {
        if (!item || typeof item !== "object") return false;

        const el = item as UiElement;
        const c = el.coordenadas;

        return !!c &&
            this.isFiniteNumber(c.x) &&
            this.isFiniteNumber(c.y) &&
            this.isFiniteNumber(c.w) &&
            this.isFiniteNumber(c.h);
    }

    private buildOverlaySvg(params: {
        width: number;
        height: number;
        ui: UiElement[];
        stroke: string;
        fill: string;
        includeLabel: boolean;
    }): string {
        const { width, height, ui, stroke, fill, includeLabel } = params;

        const strokeWidth = Math.max(2, Math.round(Math.min(width, height) * 0.0035));
        const fontSize = Math.max(12, Math.round(Math.min(width, height) * 0.018));

        const itemsSvg = ui
            .map((item) => {
                const box = this.normalizeBox(item.coordenadas, width, height);
                if (!box || box.w <= 0 || box.h <= 0) return "";

                const label = includeLabel ? this.escapeXml(this.buildLabel(item)) : "";
                const tagWidth = Math.min(
                    Math.max(80, width - box.x),
                    Math.max(80, Math.round(label.length * (fontSize * 0.58) + 12))
                );
                const tagHeight = fontSize + 10;
                const tagY = Math.max(0, box.y - tagHeight - 4);
                const textY = tagY + fontSize + 1;

                return `
          <g>
            <rect
              x="${box.x}"
              y="${box.y}"
              width="${box.w}"
              height="${box.h}"
              fill="${fill}"
              stroke="${stroke}"
              stroke-width="${strokeWidth}"
            />
            ${params.includeLabel && label
                        ? `
                <rect
                  x="${box.x}"
                  y="${tagY}"
                  width="${tagWidth}"
                  height="${tagHeight}"
                  fill="${stroke}"
                  rx="4"
                  ry="4"
                />
                <text
                  x="${box.x + 6}"
                  y="${textY}"
                  font-size="${fontSize}"
                  font-family="Arial, Helvetica, sans-serif"
                  fill="#ffffff"
                >${label}</text>
              `
                        : ""
                    }
          </g>
        `;
            })
            .join("");

        return `
      <svg
        width="${width}"
        height="${height}"
        viewBox="0 0 ${width} ${height}"
        xmlns="http://www.w3.org/2000/svg"
      >
        ${itemsSvg}
      </svg>
    `;
    }

    private normalizeBox(
        coords: BoundingBox,
        imageWidth: number,
        imageHeight: number
    ): BoundingBox | null {
        const x = Number(coords.x);
        const y = Number(coords.y);
        const w = Number(coords.w);
        const h = Number(coords.h);

        if ([x, y, w, h].some((n) => Number.isNaN(n))) {
            return null;
        }

        const safeX = this.clamp(x, 0, imageWidth);
        const safeY = this.clamp(y, 0, imageHeight);
        const safeW = this.clamp(w, 0, imageWidth - safeX);
        const safeH = this.clamp(h, 0, imageHeight - safeY);

        return {
            x: safeX,
            y: safeY,
            w: safeW,
            h: safeH,
        };
    }

    private buildLabel(item: UiElement): string {
        const parts: string[] = [];

        if (item.type) parts.push(`[${item.type}]`);
        if (item.id) parts.push(item.id);
        if (item.text) parts.push(`- ${this.truncate(item.text, 40)}`);

        return parts.join(" ");
    }

    private parseBase64Image(base64OrDataUri: string): {
        buffer: Buffer;
        mimeType?: string;
    } {
        if (!base64OrDataUri || typeof base64OrDataUri !== "string") {
            throw new Error("imageBase64 inválido.");
        }

        const match = base64OrDataUri.match(/^data:(.+?);base64,(.+)$/);

        if (match) {
            return {
                mimeType: match[1],
                buffer: Buffer.from(match[2], "base64")
            };
        }

        return {
            buffer: Buffer.from(base64OrDataUri, "base64"),
        };
    }

    private getMimeType(format: OutputFormat): string {
        switch (format) {
            case "jpeg":
                return "image/jpeg";
            case "webp":
                return "image/webp";
            case "png":
            default:
                return "image/png";
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
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }
}
