import {
  AnalisysPromptVersion,
  DEFAULT_ANALISYS_PROMPT_VERSION,
  ProfileKey,
} from "../services/llm/LLMsProfiles";
import { ILLMService } from "../services/llm/ILLMService";
import { resolveTemperature } from "../services/llm/ILLMService";
import { ResultWriter } from "../services/results/ResultWriter";

type LLMServiceMap = Record<ProfileKey, ILLMService>;

type StepRequestBody = {
  models: string[];
  objective: string;
  stepIndex: number;
  imageBase64: string;
  uiJson?: string;
  historySummary?: string;
  profiles?: ProfileKey[];
  temperature?: number;
  /** Versão do prompt AnalisysComponentsLLM (ex.: v1). */
  promptVersion?: AnalisysPromptVersion;
  /** Se true, grava em results/ com nome explícito (prompt + temp). */
  saveToDisk?: boolean;
  domain?: string;
  caseId?: string;
  testNumber?: number | null;
  testVersion?: string | null;
  sourceImage?: string;
  runIndex?: number;
  /** execN dentro de prompt-<versão>; omitido = aloca automaticamente. */
  execId?: number;
};

function countUiComponents(raw: unknown): unknown {
  try {
    let text: string | null = null;
    const anyRaw = raw as any;
    const msg = anyRaw?.choices?.[0]?.message?.content;
    if (typeof msg === "string") text = msg;
    if (!text) {
      const part = anyRaw?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof part === "string") text = part;
    }
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed?.components && Array.isArray(parsed.components)) {
      return parsed.components;
    }
    return null;
  } catch {
    return null;
  }
}

export class StepController {
  constructor(
    private readonly services: LLMServiceMap,
    private readonly resultWriter: ResultWriter = new ResultWriter(),
  ) {}

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
      temperature,
      promptVersion,
      saveToDisk,
      domain,
      caseId,
      testNumber,
      testVersion,
      sourceImage,
      runIndex,
      execId,
    } = req.body as StepRequestBody;

    const profilesToRun: ProfileKey[] =
      profiles && profiles.length > 0 ? profiles : ["AnalisysComponentsLLM"];

    const temp = resolveTemperature(temperature);
    const analisysVersion =
      promptVersion ?? DEFAULT_ANALISYS_PROMPT_VERSION;

    const results = await Promise.all(
      profilesToRun.flatMap((profileKey) =>
        models.map(async (model) => {
          const service = this.services[profileKey];
          if (!service) {
            throw new Error(`LLMService not found for profile: ${profileKey}`);
          }

          const output = await service.callModel({
            objective,
            stepIndex,
            imageBase64,
            uiJson,
            historySummary,
            profile: profileKey,
            model,
            temperature: temp,
            promptVersion:
              profileKey === "AnalisysComponentsLLM"
                ? analisysVersion
                : undefined,
          });

          const ui = countUiComponents(output.rawResponse);

          const base = {
            profile: profileKey,
            model,
            temperature: output.temperature ?? temp,
            promptVersion:
              profileKey === "AnalisysComponentsLLM"
                ? output.promptVersion ?? analisysVersion
                : undefined,
            action: output.action,
            rationale: output.rationale,
            confidence: output.confidence,
            rawResponse: output.rawResponse,
            ui,
          };

          if (saveToDisk) {
            const saved = await this.resultWriter.save(
              {
                domain: domain ?? "manual",
                caseId: caseId ?? `step-${stepIndex}`,
                testNumber: testNumber ?? stepIndex,
                testVersion: testVersion ?? null,
                profile: profileKey,
                model,
                temperature: base.temperature,
                promptVersion: base.promptVersion,
                objective,
                stepIndex,
                sourceImage,
                runIndex,
                execId,
              },
              {
                action: base.action,
                rationale: base.rationale,
                confidence: base.confidence,
                rawResponse: base.rawResponse,
                ui: base.ui,
              },
            );
            return {
              ...base,
              execId: saved.execId,
              savedPath: saved.savedPath,
              savedAt: saved.savedAt,
            };
          }

          return base;
        }),
      ),
    );

    return res.send({
      sessionId,
      stepIndex,
      objective,
      temperature: temp,
      promptVersion: analisysVersion,
      results,
    });
  };
}
