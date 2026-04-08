// LLMController.ts
import { classifyLLMError }          from "../services/ErrorHandler";
import { LlmImageAnnotatorService } from "../services/ImageAnnotationScale";
import { ILLMService }               from "../services/llm/ILLMService";
import { ProfileKey }                from "../services/llm/LLMsProfiles";
import { QueueService }              from "../services/QueueService";

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
};

// ── instâncias do anotador por escala ────────────────────────────────────────
const annotatorImage = new LlmImageAnnotatorService(); // coordScale: "pixels" (legado)

export class StepController {
  constructor(
    private readonly services:  LLMServiceMap,
    private readonly queue:     QueueService,
    private readonly outputDir: string = path.resolve("output"),
  ) {}

  /**
   * Estrutura de diretórios gerada:
   *
   * output/
   * └── {fileName}/
   *     └── step{N}/
   *         └── {profile}-{safeModel}/
   *             ├── output.json
   *             ├── full.json
   *             ├── clean.json
   *             └── scaled/                    ← coordenadas 0-1000
   *                 ├── annotated.png
   *                 └── annotated_labels.png
   */

  // ── salva um par de imagens (sem / com labels) em um subdiretório ──────────

  private async saveImages(
    imageBase64: string,
    annotator:   any,
    data:        { output: unknown },
    model:       string,
    targetDir:   string,
    coordScale:  "normalized-1000" | "pixels",
  ): Promise<void> {
    if (!imageBase64) return;

    // Garante que o subdiretório existe
    fs.mkdirSync(targetDir, { recursive: true });

    await Promise.all([
      // 1) Sem labels — visual limpo
      annotator
        .annotateFromAnalysis({
          imageBase64,
          analysis:    data.output as any,
          includeLabel: false,
          coordScale : coordScale
        })
        .then(({ buffer }: { buffer: Buffer }) =>
          fs.writeFileSync(path.join(targetDir, "annotated.png"), buffer)
        )
        .catch((err: Error) =>
          console.warn(`[StepController] ${coordScale}/annotated.png falhou (${model}):`, err.message)
        ),

      // 2) Com labels — útil para debug / revisão
      annotator
        .annotateFromAnalysis({
          imageBase64,
          analysis:    data.output as any,
          includeLabel: true,
          coordScale : coordScale
        })
        .then(({ buffer }: { buffer: Buffer }) =>
          fs.writeFileSync(path.join(targetDir, "annotated_labels.png"), buffer)
        )
        .catch((err: Error) =>
          console.warn(`[StepController] ${coordScale}/annotated_labels.png falhou (${model}):`, err.message)
        ),
    ]);
  }

  // ── salva JSONs + imagens para um job ──────────────────────────────────────

  private async saveResults(
    fileName:    string,
    profile:     string,
    model:       string,
    stepIndex:   number,
    imageBase64: string,
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

    // ── JSONs ─────────────────────────────────────────────────────────────────
    fs.writeFileSync(path.join(dir, "output.json"), JSON.stringify(data.output, null, 2), "utf-8");
    fs.writeFileSync(path.join(dir, "full.json"),   JSON.stringify(data.full,   null, 2), "utf-8");
    fs.writeFileSync(path.join(dir, "clean.json"),  JSON.stringify(data.clean,  null, 2), "utf-8");

    // ── Imagens anotadas ──────────────────────────────────────────────────────

    await this.saveImages(imageBase64, annotatorImage, data, model, path.join(dir, "pixels"), "pixels");
    // await this.saveImages(imageBase64, annotatorScale, data, model, path.join(dir, "scaled"), "normalized-1000");

    console.log(`[StepController] ✅ step${stepIndex} | ${profile} | ${model} → ${dir}`);
  }

  // ── handler HTTP ──────────────────────────────────────────────────────────

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
    } = req.body as StepRequestBody;

    const profilesToRun: ProfileKey[] =
      profiles && profiles.length > 0 ? profiles : ["AnalisysComponentsLLM"];

    const results = await Promise.all(
      profilesToRun.flatMap((profileKey) =>
        models.map(async (model) => {
          const service = this.services[profileKey];
          if (!service) {
            throw new Error(`LLMService not found for profile: ${profileKey}`);
          }

          try {
            const { output, full, clean } = await this.queue.enqueue(
              { objective, stepIndex, imageBase64, uiJson, historySummary, profile: profileKey, model },
              idsToRemove,
            );

            // Salva em background — não bloqueia a resposta HTTP
            this.saveResults(fileName, profileKey, model, stepIndex, imageBase64, { output, full, clean })
              .catch((err) =>
                console.error(`[StepController] saveResults falhou (${model}):`, err)
              );

            return { profile: profileKey, model, status: "success", output, full, clean };

          } catch (err) {
            const llmError = classifyLLMError(err);
            console.error(`[StepController] Erro no modelo ${model}:`, llmError);

            return { profile: profileKey, model, status: "error", error: llmError };
          }
        }),
      ),
    );

    return res.send({ sessionId, stepIndex, objective, results });
  };
}
