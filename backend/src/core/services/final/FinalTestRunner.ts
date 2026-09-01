import {
  AnalisysPromptVersion,
  ANALISYS_PROMPT_VERSIONS,
  normalizeAnalisysPromptVersion,
  ProfileKey,
} from "../llm/LLMsProfiles";
import { AnalisisLLM } from "../llm/AnalisisLLM";
import { GuideStep } from "../llm/GuideStepLLM";
import { GoogleLLMClient } from "../llm/GoogleService";
import { OpenRouterLLMClient } from "../llm/OpenRouterService";
import { resolveTemperature } from "../llm/ILLMService";
import { QueueService } from "../QueueService";
import { ResultWriter } from "../results/ResultWriter";
import {
  FinalCase,
  FinalCaseCatalog,
  FinalDomain,
} from "./FinalCaseCatalog";
import {
  readImageFileAsDataUrl,
  resolveImagePath,
} from "./resolveImagePath";

type LLMAPI = "OPENROUTER" | "GEMINI";

export type FinalRunContext = {
  domain: FinalDomain | string;
  caseId: string;
  testNumber: number | null;
  testVersion: string | null;
  sourceImage: string;
  imageBase64: string;
  uiJson?: string;
};

export type SingleRunParams = {
  context: FinalRunContext;
  objective: string;
  models: string[];
  LLMAPI: LLMAPI;
  profiles: ProfileKey[];
  temperature: number;
  promptVersion: AnalisysPromptVersion;
  runIndex?: number;
  execId?: number;
  saveToDisk: boolean;
  sessionId: string;
  resultWriter?: ResultWriter;
};

export type BatchRunParams = {
  imagePath?: string;
  domain?: FinalDomain;
  caseId?: string;
  testNumber?: number;
  testVersion?: string;
  objective?: string;
  models?: string[];
  LLMAPI?: LLMAPI;
  profiles?: ProfileKey[];
  temperature?: number;
  runsPerVersion?: number;
  promptVersions?: AnalisysPromptVersion[];
  includeUiJson?: boolean;
  saveToDisk?: boolean;
  sessionId?: string;
};

export class FinalTestRunner {
  private readonly catalog = new FinalCaseCatalog();

  constructor(private readonly resultWriter = new ResultWriter()) {}

  listCases(
    domain?: FinalDomain,
    testNumber?: number,
    testVersion?: string,
  ) {
    if (testNumber != null || testVersion) {
      return this.catalog.filterByNumberVersion(domain, testNumber, testVersion);
    }
    return this.catalog.list(domain);
  }

  resolveContext(params: {
    imagePath?: string;
    domain?: FinalDomain;
    caseId?: string;
    testNumber?: number;
    testVersion?: string;
    includeUiJson?: boolean;
  }): FinalRunContext {
    if (params.imagePath) {
      const img = resolveImagePath(params.imagePath);
      return {
        domain: params.domain ?? inferDomainFromPath(img.relativePath),
        caseId: params.caseId ?? img.caseId,
        testNumber: params.testNumber ?? img.testNumber,
        testVersion: params.testVersion ?? img.testVersion,
        sourceImage: img.relativePath,
        imageBase64: readImageFileAsDataUrl(img.absolutePath),
      };
    }

    if (!params.domain) {
      throw new Error("Informe imagePath ou domain");
    }

    let selected: FinalCase | null = params.caseId
      ? this.catalog.find(params.domain, params.caseId)
      : null;

    if (!selected && (params.testNumber != null || params.testVersion)) {
      const matches = this.catalog.filterByNumberVersion(
        params.domain,
        params.testNumber,
        params.testVersion,
      );
      if (matches.length === 1) selected = matches[0];
      else if (matches.length > 1) {
        throw new Error(
          `Caso ambíguo; informe caseId. Opções: ${matches.map((m) => m.caseId).join(", ")}`,
        );
      }
    }

    if (!selected) {
      throw new Error(
        `Caso Final não encontrado: ${params.domain} / ${params.caseId ?? `${params.testNumber}${params.testVersion ?? ""}`}`,
      );
    }

    const uiJson = params.includeUiJson
      ? this.catalog.readUiJson(selected.uiJsonPath)
      : undefined;

    return {
      domain: selected.domain,
      caseId: selected.caseId,
      testNumber: selected.testNumber,
      testVersion: selected.testVersion,
      sourceImage: selected.relativeImagePath,
      imageBase64: this.catalog.readImageAsDataUrl(selected.imagePath),
      uiJson,
    };
  }

  async runSingle(params: SingleRunParams): Promise<any> {
    const llmClient =
      params.LLMAPI === "GEMINI"
        ? new GoogleLLMClient()
        : new OpenRouterLLMClient();

    const analysisService = new AnalisisLLM(llmClient);
    const guideService = new GuideStep(llmClient);
    const queue = new QueueService(analysisService, 1);
    const writer = params.resultWriter ?? this.resultWriter;
    const { context } = params;

    const results = await Promise.all(
      params.profiles.flatMap((profileKey) =>
        params.models.map(async (model) => {
          let output: any;
          let full: unknown[] = [];
          let clean: unknown[] = [];

          if (profileKey === "AnalisysComponentsLLM") {
            const result = await queue.enqueue({
              model,
              profile: profileKey,
              objective: params.objective,
              stepIndex: context.testNumber ?? 1,
              imageBase64: context.imageBase64,
              uiJson: context.uiJson,
              temperature: params.temperature,
              promptVersion: params.promptVersion,
            });
            output = result.output;
            full = result.full;
            clean = result.clean;
          } else {
            const service =
              profileKey === "GuideLLM" ? guideService : analysisService;
            const result = await service.callModel({
              model,
              profile: profileKey,
              objective: params.objective,
              stepIndex: context.testNumber ?? 1,
              imageBase64: context.imageBase64,
              uiJson: context.uiJson,
            });
            if (result && typeof result === "object" && "output" in result) {
              output = result.output;
              full = (result as any).full ?? [];
              clean = (result as any).clean ?? [];
            } else {
              output = result;
            }
          }

          const base = {
            profile: profileKey,
            model,
            temperature: params.temperature,
            promptVersion:
              profileKey === "AnalisysComponentsLLM"
                ? params.promptVersion
                : undefined,
            status: "success" as const,
            output,
            full,
            clean,
          };

          if (params.saveToDisk && profileKey === "AnalisysComponentsLLM") {
            const saved = await writer.save(
              {
                domain: String(context.domain),
                caseId: context.caseId,
                testNumber: context.testNumber,
                testVersion: context.testVersion,
                profile: profileKey,
                model,
                temperature: params.temperature,
                promptVersion: params.promptVersion,
                objective: params.objective,
                stepIndex: context.testNumber ?? 1,
                sourceImage: context.sourceImage,
                runIndex: params.runIndex,
                execId: params.execId,
              },
              {
                action: output.action ?? "",
                rationale: output.rationale ?? "",
                confidence: output.confidence ?? 0,
                rawResponse: output.rawResponse,
                ui: full,
              },
              { imageBase64: context.imageBase64 },
            );

            return {
              ...base,
              execId: saved.execId,
              savedPath: saved.savedPath,
              savedAt: saved.savedAt,
              annotationDirs: saved.annotationDirs,
            };
          }

          return base;
        }),
      ),
    );

    return {
      sessionId: params.sessionId,
      stepIndex: context.testNumber ?? 1,
      objective: params.objective,
      temperature: params.temperature,
      promptVersion: params.promptVersion,
      results,
    };
  }

  async runBatch(params: BatchRunParams) {
    const {
      objective = "Inventariar todos os componentes visíveis na interface.",
      models,
      LLMAPI = "GEMINI",
      profiles = ["AnalisysComponentsLLM"],
      temperature,
      runsPerVersion = 1,
      promptVersions,
      includeUiJson = false,
      saveToDisk = true,
      sessionId = "final-batch",
    } = params;

    const context = this.resolveContext({
      imagePath: params.imagePath,
      domain: params.domain,
      caseId: params.caseId,
      testNumber: params.testNumber,
      testVersion: params.testVersion,
      includeUiJson,
    });

    const versions =
      promptVersions && promptVersions.length > 0
        ? promptVersions.map((v) => normalizeAnalisysPromptVersion(String(v)))
        : [...ANALISYS_PROMPT_VERSIONS];

    const modelList =
      models && models.length > 0
        ? models
        : LLMAPI === "GEMINI"
          ? ["gemini-2.5-flash"]
          : ["nvidia/nemotron-nano-12b-v2-vl:free"];

    const temp = resolveTemperature(temperature);
    const runs = Math.max(1, Math.floor(runsPerVersion));

    const allResults: Array<{
      promptVersion: AnalisysPromptVersion;
      execId: number;
      runIndex: number;
      results: unknown;
      savedPaths: string[];
    }> = [];

    const batchWriter = new ResultWriter();

    for (const promptVersion of versions) {
      const execId = batchWriter.allocateExecId({
        domain: String(context.domain),
        caseId: context.caseId,
        profile: "AnalisysComponentsLLM",
        promptVersion,
      });
      batchWriter.resolveExecId(
        {
          domain: String(context.domain),
          caseId: context.caseId,
          profile: "AnalisysComponentsLLM",
          promptVersion,
        },
        execId,
      );

      for (let runIndex = 1; runIndex <= runs; runIndex++) {
        const payload = await this.runSingle({
          context,
          objective,
          models: modelList,
          LLMAPI,
          profiles,
          temperature: temp,
          promptVersion,
          runIndex,
          execId,
          saveToDisk,
          sessionId: `${sessionId}-${promptVersion}-exec${execId}-run${runIndex}`,
          resultWriter: batchWriter,
        });

        const savedPaths = (payload.results ?? [])
          .map((r: any) => r.savedPath)
          .filter(Boolean);

        allResults.push({
          promptVersion,
          execId,
          runIndex,
          results: payload.results,
          savedPaths,
        });
      }
    }

    return {
      case: {
        domain: context.domain,
        caseId: context.caseId,
        testNumber: context.testNumber,
        testVersion: context.testVersion,
        sourceImage: context.sourceImage,
      },
      runsPerVersion: runs,
      promptVersions: versions,
      temperature: temp,
      totalRequests: versions.length * runs,
      runs: allResults,
    };
  }
}

function inferDomainFromPath(relativePath: string): string {
  const top = relativePath.split(/[/\\]/)[0];
  if (top === "Americanas" || top === "Limeira" || top === "LibreOffice") {
    return top;
  }
  return "manual";
}
