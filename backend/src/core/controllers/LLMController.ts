// LLMController.ts
import { classifyLLMError }                              from "../services/ErrorHandler";
import { LlmImageAnnotatorService }                      from "../services/ImageAnnotationScale";
import { ILLMService }                                   from "../services/llm/ILLMService";
import { ProfileKey }                                    from "../services/llm/LLMsProfiles";
import { QueueService }                                  from "../services/QueueService";
import * as fs   from "fs";
import * as path from "path";

type LLMServiceMap = Record<ProfileKey, ILLMService>;

type StepRequestBody = {
  models:          string[];
  objective:       string;
  stepIndex:       number;
  imageBase64:     string;
  fileName:        string;
  uiJson?:         string;
  historySummary?: string;
  profiles?:       ProfileKey[];
  idsToRemove?:    string[];
};

const annotator = new LlmImageAnnotatorService();

export class StepController {
  constructor(
    private readonly services:  LLMServiceMap,
    private readonly queue:     QueueService,
    private readonly outputDir: string = path.resolve("output"),
  ) {}

  /**
   * Salva as 4 variantes de anotação em 2 pastas:
   *
   * pixels/
   *   A_pixels_pure.png          — coordenadas em pixels desenhadas direto
   *   A_pixels_pure_labels.png
   *   B_pixels_via_norm.png      — pixels ÷ imgW/imgH → 0-1000 → volta a px
   *   B_pixels_via_norm_labels.png
   *
   * normalized/
   *   C_norm1000_correct.png     — JSON já em 0-1000, conversão correta
   *   C_norm1000_correct_labels.png
   *   D_norm1000_raw.png         — pixels tratados como 0-1000 (sem dividir)
   *   D_norm1000_raw_labels.png
   */
  private async saveQuadImages(
    imageBase64: string,
    uiElements:  unknown[],
    model:       string,
    baseDir:     string,
  ): Promise<void> {
    if (!imageBase64 || !uiElements.length) return;

    const pixelsDir = path.join(baseDir, "pixels");
    const normDir   = path.join(baseDir, "normalized");
    fs.mkdirSync(pixelsDir, { recursive: true });
    fs.mkdirSync(normDir,   { recursive: true });

    for (const withLabels of [false, true] as const) {
      try {
        const quad = await annotator.annotateQuad({
          imageBase64,
          analysis:     { ui: uiElements as any },
          includeLabel: withLabels,
        });

        const suffix = withLabels ? "_labels.png" : ".png";

        // pixels/
        fs.writeFileSync(path.join(pixelsDir, `A_pixels_pure${suffix}`),     quad.pixels.A.buffer);
        fs.writeFileSync(path.join(pixelsDir, `B_pixels_via_norm${suffix}`), quad.pixels.B.buffer);

        // normalized/
        fs.writeFileSync(path.join(normDir, `C_norm1000_correct${suffix}`), quad.normalized.C.buffer);
        fs.writeFileSync(path.join(normDir, `D_norm1000_raw${suffix}`),     quad.normalized.D.buffer);

        console.log(
          `[StepController] 🖼️  quad saved (${model}, labels=${withLabels})` +
          ` | img ${quad.pixels.A.width}×${quad.pixels.A.height}` +
          ` | ${uiElements.length} elements`,
        );
      } catch (err: any) {
        console.warn(
          `[StepController] saveQuadImages failed (${model}, labels=${withLabels}):`,
          err?.message,
        );
      }
    }
  }

  private async saveResults(
    fileName:    string,
    profile:     string,
    model:       string,
    stepIndex:   number,
    imageBase64: string,
    data: { output: unknown; full: unknown[]; clean: unknown[] },
  ): Promise<void> {
    const safeModel = model.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const dir = path.join(
      this.outputDir, fileName, `step${stepIndex}`, `${profile}-${safeModel}`,
    );
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, "output.json"), JSON.stringify(data.output, null, 2), "utf-8");
    fs.writeFileSync(path.join(dir, "full.json"),   JSON.stringify(data.full,   null, 2), "utf-8");
    fs.writeFileSync(path.join(dir, "clean.json"),  JSON.stringify(data.clean,  null, 2), "utf-8");

    await this.saveQuadImages(imageBase64, data.full, model, dir);

    console.log(`[StepController] ✅ step${stepIndex} | ${profile} | ${model} → ${dir}`);
  }

  createHandler = async (req: any, res: any) => {
    const { sessionId } = req.params as { sessionId: string };
    const {
      objective, imageBase64, stepIndex, historySummary,
      profiles, uiJson, models, fileName, idsToRemove,
    } = req.body as StepRequestBody;

    const profilesToRun: ProfileKey[] =
      profiles && profiles.length > 0 ? profiles : ["AnalisysComponentsLLM"];

    const results = await Promise.all(
      profilesToRun.flatMap((profileKey) =>
        models.map(async (model) => {
          const service = this.services[profileKey];
          if (!service) throw new Error(`LLMService not found for profile: ${profileKey}`);
          try {
            const { output, full, clean } = await this.queue.enqueue(
              { objective, stepIndex, imageBase64, uiJson, historySummary, profile: profileKey, model },
              idsToRemove,
            );
            // fire-and-forget — não bloqueia a resposta HTTP
            this.saveResults(
              fileName, profileKey, model, stepIndex, imageBase64,
              { output, full: full as unknown[], clean: clean as unknown[] },
            ).catch((err) =>
              console.error(`[StepController] saveResults failed (${model}):`, err),
            );
            return { profile: profileKey, model, status: "success", output, full, clean };
          } catch (err) {
            const llmError = classifyLLMError(err);
            console.error(`[StepController] Error on model ${model}:`, llmError);
            return { profile: profileKey, model, status: "error", error: llmError };
          }
        }),
      ),
    );

    return res.send({ sessionId, stepIndex, objective, results });
  };
}
