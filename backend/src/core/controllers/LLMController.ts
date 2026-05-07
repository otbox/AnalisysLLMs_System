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
   * Coordinate system the LLM used when returning bounding boxes.
   * Defaults to the controller-level default set in server.ts.
   * Can be overridden per-request.
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
     * Set to "pixels" because the active profile (v6pixels / AnalisysComponentsLLM)
     * asks the model for absolute pixel coordinates.
     * Change here in server.ts if you switch to a normalised-1000 profile.
     */
    private readonly defaultCoordScale: CoordScale = "pixels",
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

  // ── Save a dual annotation (pixels + scaled) ────────────────────────────

  private async saveDualImages(
    imageBase64: string,
    /**
     * Pass the PARSED ui elements (full[]) directly — NOT the raw LLM output
     * object. This guarantees extractUiElements() finds them under the "ui"
     * key without having to chase rawResponse.candidates chains.
     */
    uiElements:  unknown[],
    model:       string,
    baseDir:     string,
    coordScale:  CoordScale,
  ): Promise<void> {
    if (!imageBase64 || !uiElements.length) return;

    for (const withLabels of [false, true]) {
      try {
        const dual = await annotator.annotateDual({
          imageBase64,
          // Pass elements under the "ui" key so extractUiElements() finds them
          // on the first fast-path check without any rawResponse parsing.
          analysis:     { ui: uiElements as any },
          includeLabel: withLabels,
          coordScale,
        });

        const suffix    = withLabels ? "annotated_labels.png" : "annotated.png";
        const pixelsDir = path.join(baseDir, "pixels");
        const scaledDir = path.join(baseDir, "scaled");
        fs.mkdirSync(pixelsDir, { recursive: true });
        fs.mkdirSync(scaledDir, { recursive: true });

        fs.writeFileSync(path.join(pixelsDir, suffix), dual.pixels.buffer);
        fs.writeFileSync(path.join(scaledDir, suffix), dual.scaled.buffer);

        console.log(
          `[StepController] 🖼️  dual images saved ` +
          `pixels=${dual.pixels.width}×${dual.pixels.height} ` +
          `scaled=${dual.scaled.width}×${dual.scaled.height} ` +
          `(${uiElements.length} elements, labels=${withLabels})`,
        );
      } catch (err: any) {
        console.warn(
          `[StepController] saveDualImages failed (${model}, labels=${withLabels}):`,
          err?.message,
        );
      }
    }
  }

  // ── Save JSONs + dual images for one job ──────────────────────────────

  private async saveResults(
    fileName:    string,
    profile:     string,
    model:       string,
    stepIndex:   number,
    imageBase64: string,
    coordScale:  CoordScale,
    data: { output: unknown; full: unknown[]; clean: unknown[] },
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

    // Use full[] (already-parsed ui elements) — NOT output (raw LLM response)
    // so the annotator doesn't have to dig through rawResponse.candidates.
    await this.saveDualImages(imageBase64, data.full, model, dir, coordScale);

    console.log(`[StepController] ✅ step${stepIndex} | ${profile} | ${model} → ${dir}`);
  }

  // ── HTTP handler ─────────────────────────────────────────────────────────────────

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

    // Per-request override; falls back to controller default ("pixels").
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

            // Fire-and-forget — does not block the HTTP response
            this.saveResults(
              fileName, profileKey, model, stepIndex, imageBase64, coordScale,
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
