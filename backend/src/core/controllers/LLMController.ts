// LLMController.ts
import { classifyLLMError }                              from "../services/ErrorHandler";
import { CoordScale, LlmImageAnnotatorService }          from "../services/ImageAnnotationScale";
import { ILLMService }                                   from "../services/llm/ILLMService";
import { ProfileKey }                                    from "../services/llm/LLMsProfiles";
import { QueueService }                                  from "../services/QueueService";

import * as fs   from "fs";
import * as path from "path";

type LLMServiceMap = Record<ProfileKey, ILLMService>;

type StepRequestBody = {
  models:           string[];
  objective:        string;
  stepIndex:        number;
  imageBase64:      string;
  fileName:         string;
  uiJson?:          string;
  historySummary?:  string;
  profiles?:        ProfileKey[];
  idsToRemove?:     string[];
  /**
   * Coordinate system the LLM will use when returning bounding boxes.
   * Defaults to "normalized-1000".
   * Set once in server.ts / the HTTP request; propagated to all save calls.
   */
  coordScale?:      CoordScale;
};

const annotator = new LlmImageAnnotatorService();

export class StepController {
  constructor(
    private readonly services:   LLMServiceMap,
    private readonly queue:      QueueService,
    private readonly outputDir:  string    = path.resolve("output"),
    /**
     * Default coord scale used when the request body does not specify one.
     * Inject this from server.ts so there is a single configuration point.
     */
    private readonly defaultCoordScale: CoordScale = "normalized-1000",
  ) {}

  /**
   * Directory structure:
   *
   * output/
   * └── {fileName}/
   *     └── step{N}/
   *         └── {profile}-{safeModel}/
   *             ├── output.json
   *             ├── full.json
   *             ├── clean.json
   *             ├── pixels/
   *             │   ├── annotated.png
   *             │   └── annotated_labels.png
   *             └── scaled/
   *                 ├── annotated.png
   *                 └── annotated_labels.png
   */

  // ── Save a dual annotation (pixels + scaled) ─────────────────────────────

  private async saveDualImages(
    imageBase64: string,
    data:        { output: unknown },
    model:       string,
    baseDir:     string,
    coordScale:  CoordScale,
  ): Promise<void> {
    if (!imageBase64) return;

    for (const withLabels of [false, true]) {
      try {
        const dual = await annotator.annotateDual({
          imageBase64,
          analysis:    data.output as any,
          includeLabel: withLabels,
          coordScale,
        });

        const suffix = withLabels ? "annotated_labels.png" : "annotated.png";

        const pixelsDir = path.join(baseDir, "pixels");
        const scaledDir = path.join(baseDir, "scaled");
        fs.mkdirSync(pixelsDir, { recursive: true });
        fs.mkdirSync(scaledDir, { recursive: true });

        fs.writeFileSync(path.join(pixelsDir, suffix), dual.pixels.buffer);
        fs.writeFileSync(path.join(scaledDir, suffix), dual.scaled.buffer);
      } catch (err: any) {
        console.warn(
          `[StepController] saveDualImages failed (${model}, labels=${withLabels}):`,
          err?.message,
        );
      }
    }
  }

  // ── Save JSONs + dual images for one job ─────────────────────────────────

  private async saveResults(
    fileName:    string,
    profile:     string,
    model:       string,
    stepIndex:   number,
    imageBase64: string,
    coordScale:  CoordScale,
    data: { output: unknown; full: unknown; clean: unknown },
  ): Promise<void> {
    const safeModel = model.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const dir = path.join(
      this.outputDir,
      fileName,
      `step${stepIndex}`,
      `${profile}-${safeModel}`,
    );

    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, "output.json"), JSON.stringify(data.output, null, 2), "utf-8");
    fs.writeFileSync(path.join(dir, "full.json"),   JSON.stringify(data.full,   null, 2), "utf-8");
    fs.writeFileSync(path.join(dir, "clean.json"),  JSON.stringify(data.clean,  null, 2), "utf-8");

    await this.saveDualImages(imageBase64, data, model, dir, coordScale);

    console.log(`[StepController] ✅ step${stepIndex} | ${profile} | ${model} → ${dir}`);
  }

  // ── HTTP handler ─────────────────────────────────────────────────────────

  createHandler = async (req: any, res: any) => {
    const { sessionId } = req.params as { sessionId: string };

    const {
      objective,
      imageBase64,
      stepIndex,
      historySummary,
      profiles,
      uiJson,
      models,
      fileName,
      idsToRemove,
      coordScale: requestCoordScale,
    } = req.body as StepRequestBody;

    // Use request-level coordScale if provided; otherwise fall back to the
    // controller default (configured once in server.ts).
    const coordScale: CoordScale = requestCoordScale ?? this.defaultCoordScale;

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

            this.saveResults(fileName, profileKey, model, stepIndex, imageBase64, coordScale, { output, full, clean })
              .catch((err) => console.error(`[StepController] saveResults failed (${model}):`, err));

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
