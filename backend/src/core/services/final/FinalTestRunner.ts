import {
  AnalisysPromptVersion,
  DEFAULT_ANALISYS_PROMPT_VERSION,
  ProfileKey,
} from "../llm/LLMsProfiles";
import { AnalisisLLM } from "../llm/AnalisisLLM";
import { GuideStep } from "../llm/GuideStepLLM";
import { GoogleLLMClient } from "../llm/GoogleService";
import { OpenRouterLLMClient } from "../llm/OpenRouterService";
import { resolveTemperature } from "../llm/ILLMService";
import { ResultWriter } from "../results/ResultWriter";
import { StepController } from "../../controllers/LLMController";
import {
  FinalCase,
  FinalCaseCatalog,
  FinalDomain,
} from "./FinalCaseCatalog";
import {
  readImageFileAsDataUrl,
  resolveImagePath,
  ResolvedImageSource,
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
  /** Caminho absoluto ou relativo à imagem (alternativa a domain/caseId). */
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
  /** Repetições por versão de prompt (N). */
  runsPerVersion?: number;
  /** Versões a testar; default = todas registradas ou [v1]. */
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

    const writer = params.resultWriter ?? this.resultWriter;

    const stepController = new StepController(
      {
        AnalisysComponentsLLM: new AnalisisLLM(llmClient),
        GuideLLM: new GuideStep(llmClient),
        CongnitiveWalktroughLLM: new AnalisisLLM(llmClient),
      },
      writer,
    );

    const { context } = params;
    let payload: any;

    const fakeReq = {
      params: { sessionId: params.sessionId },
      body: {
        models: params.models,
        objective: params.objective,
        stepIndex: context.testNumber ?? 1,
        imageBase64: context.imageBase64,
        uiJson: context.uiJson,
        profiles: params.profiles,
        temperature: params.temperature,
        promptVersion: params.promptVersion,
        saveToDisk: params.saveToDisk,
        domain: context.domain,
        caseId: context.caseId,
        testNumber: context.testNumber,
        testVersion: context.testVersion,
        sourceImage: context.sourceImage,
        runIndex: params.runIndex,
        execId: params.execId,
        LLMAPI: params.LLMAPI,
      },
    };

    const fakeRes = {
      send: (data: any) => {
        payload = data;
        return data;
      },
    };

    await stepController.createHandler(fakeReq, fakeRes);
    return payload;
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
        ? promptVersions
        : [DEFAULT_ANALISYS_PROMPT_VERSION];

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
