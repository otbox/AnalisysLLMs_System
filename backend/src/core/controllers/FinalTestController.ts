import {
  AnalisysPromptVersion,
  DEFAULT_ANALISYS_PROMPT_VERSION,
  normalizeAnalisysPromptVersion,
  ProfileKey,
} from "../services/llm/LLMsProfiles";
import { resolveTemperature } from "../services/llm/ILLMService";
import { FinalDomain } from "../services/final/FinalCaseCatalog";
import { FinalTestRunner } from "../services/final/FinalTestRunner";
import { ResultAnnotationService } from "../services/results/ResultAnnotationService";
import { ResultWriter, resolveResultsRoot } from "../services/results/ResultWriter";
import fs from "fs";
import path from "path";

type LLMAPI = "OPENROUTER" | "GEMINI";

type FinalTestBody = {
  /** Caminho da imagem (absoluto ou relativo a Final/ / repo). */
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
  promptVersion?: AnalisysPromptVersion;
  promptVersions?: AnalisysPromptVersion[];
  /** N repetições por versão de prompt. */
  runsPerVersion?: number;
  includeUiJson?: boolean;
  saveToDisk?: boolean;
  sessionId?: string;
};

function collectAnalisysResponseJson(
  root: string,
  domain?: string,
  caseId?: string,
): string[] {
  const out: string[] = [];
  const prefix =
    domain && caseId
      ? path.join(root, domain, caseId)
      : root;

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith("-response.json") &&
        entry.name.includes("AnalisysComponentsLLM")
      ) {
        out.push(full);
      }
    }
  }

  walk(prefix);
  return out.sort();
}

export class FinalTestController {
  private readonly runner = new FinalTestRunner();
  private readonly annotationService = new ResultAnnotationService();

  listHandler = async (req: any, res: any) => {
    try {
      const domain = req.query?.domain as FinalDomain | undefined;
      const testNumber =
        req.query?.testNumber != null
          ? Number(req.query.testNumber)
          : undefined;
      const testVersion = req.query?.testVersion as string | undefined;

      const cases = this.runner.listCases(domain, testNumber, testVersion);

      return res.send({
        finalRoot: process.env.FINAL_DATASET_PATH ?? "(default ../Final)",
        count: cases.length,
        cases: cases.map((c) => ({
          domain: c.domain,
          caseId: c.caseId,
          testNumber: c.testNumber,
          testVersion: c.testVersion,
          relativeImagePath: c.relativeImagePath,
          imagePath: c.imagePath,
          hasUiJson: Boolean(c.uiJsonPath),
        })),
      });
    } catch (err: any) {
      return res.status(500).send({ error: err.message });
    }
  };

  runHandler = async (req: any, res: any) => {
    try {
      const body = req.body as FinalTestBody;
      const runs = body.runsPerVersion ?? 1;
      const versions =
        body.promptVersions ??
        (body.promptVersion ? [body.promptVersion] : undefined);

      if (runs > 1 || (versions && versions.length > 1)) {
        const batch = await this.runner.runBatch({
          ...body,
          promptVersions: versions?.map((v) =>
            normalizeAnalisysPromptVersion(String(v)),
          ),
          runsPerVersion: runs,
        });
        return res.send(batch);
      }

      const context = this.runner.resolveContext({
        imagePath: body.imagePath,
        domain: body.domain,
        caseId: body.caseId,
        testNumber: body.testNumber,
        testVersion: body.testVersion,
        includeUiJson: body.includeUiJson,
      });

      const promptVersion = normalizeAnalisysPromptVersion(
        body.promptVersion ?? DEFAULT_ANALISYS_PROMPT_VERSION,
      );
      const writer = new ResultWriter();
      const execId = writer.allocateExecId({
        domain: String(context.domain),
        caseId: context.caseId,
        profile: "AnalisysComponentsLLM",
        promptVersion,
      });

      const payload = await this.runner.runSingle({
        context,
        objective:
          body.objective ??
          "Inventariar todos os componentes visíveis na interface.",
        models:
          body.models ??
          (body.LLMAPI === "OPENROUTER"
            ? ["nvidia/nemotron-nano-12b-v2-vl:free"]
            : ["gemini-2.5-flash"]),
        LLMAPI: body.LLMAPI ?? "GEMINI",
        profiles: body.profiles ?? ["AnalisysComponentsLLM"],
        temperature: resolveTemperature(body.temperature),
        promptVersion,
        runIndex: 1,
        execId,
        saveToDisk: body.saveToDisk ?? true,
        sessionId: body.sessionId ?? "final-test",
        resultWriter: writer,
      });

      return res.send({
        case: {
          domain: context.domain,
          caseId: context.caseId,
          testNumber: context.testNumber,
          testVersion: context.testVersion,
          sourceImage: context.sourceImage,
        },
        promptVersion,
        execId,
        temperature: resolveTemperature(body.temperature),
        ...payload,
      });
    } catch (err: any) {
      const status = err.message?.includes("não encontrad") ? 404 : 400;
      return res.status(status).send({ error: err.message });
    }
  };

  /**
   * Anota JSONs já salvos (sem LLM).
   * Body: { resultsRoot?, domain?, caseId?, force? }
   */
  annotateHandler = async (req: any, res: any) => {
    try {
      const body = (req.body ?? {}) as {
        resultsRoot?: string;
        domain?: string;
        caseId?: string;
        force?: boolean;
      };

      const root = body.resultsRoot
        ? path.resolve(body.resultsRoot)
        : resolveResultsRoot();

      const files = collectAnalisysResponseJson(root, body.domain, body.caseId);
      const annotated: string[] = [];
      const skipped: string[] = [];
      const errors: Array<{ path: string; error: string }> = [];

      for (const jsonPath of files) {
        try {
          const dirs = await this.annotationService.annotateSavedResult(
            jsonPath,
            undefined,
            { force: body.force },
          );
          if (!dirs) skipped.push(jsonPath);
          else annotated.push(jsonPath);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ path: jsonPath, error: msg });
        }
      }

      return res.send({
        resultsRoot: root,
        total: files.length,
        annotated: annotated.length,
        skipped: skipped.length,
        errors,
        annotatedPaths: annotated,
        skippedPaths: skipped,
      });
    } catch (err: any) {
      return res.status(500).send({ error: err.message });
    }
  };

  /** N execuções × cada versão de prompt, mesma imagem. */
  batchHandler = async (req: any, res: any) => {
    try {
      const body = req.body as FinalTestBody;
      if (!body.imagePath && !body.domain) {
        return res.status(400).send({
          error: "Informe imagePath ou domain (+ caseId ou number+version)",
        });
      }
      const result = await this.runner.runBatch(body);
      return res.send(result);
    } catch (err: any) {
      const status = err.message?.includes("não encontrad") ? 404 : 400;
      return res.status(status).send({ error: err.message });
    }
  };
}
