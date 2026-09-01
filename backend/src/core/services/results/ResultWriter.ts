import fs from "fs";
import path from "path";
import {
  AnalisysPromptVersion,
  normalizeAnalisysPromptVersion,
  ProfileKey,
} from "../llm/LLMsProfiles";
import {
  AnnotationDirs,
  ResultAnnotationService,
} from "./ResultAnnotationService";

export type ResultSaveMeta = {
  domain: string;
  caseId: string;
  testNumber: number | null;
  testVersion: string | null;
  profile: ProfileKey;
  model: string;
  temperature: number;
  promptVersion?: AnalisysPromptVersion;
  /** Repetição N dentro da mesma execução (1..runsPerVersion). */
  runIndex?: number;
  /** Pasta execN dentro de prompt-<versão>; alocada automaticamente se omitida. */
  execId?: number;
  objective: string;
  stepIndex: number;
  sourceImage?: string;
};

export type SavedResultPayload = ResultSaveMeta & {
  action: string;
  rationale: string;
  confidence: number;
  rawResponse: unknown;
  ui?: unknown;
  savedAt: string;
  savedPath: string;
  annotationDirs?: AnnotationDirs;
};

function sanitizeSegment(value: string): string {
  return value
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

type ExecScopeMeta = Pick<
  ResultSaveMeta,
  "domain" | "caseId" | "profile" | "promptVersion"
>;

/**
 * Base: results/<domínio>/<caseId>/prompt-<versão>/
 * ou results/<domínio>/<caseId>/<profile>/
 */
export function buildPromptBaseDirectory(
  resultsRoot: string,
  meta: ExecScopeMeta,
): string {
  const segments = [
    resultsRoot,
    sanitizeSegment(meta.domain),
    sanitizeSegment(meta.caseId),
  ];

  if (meta.profile === "AnalisysComponentsLLM" && meta.promptVersion) {
    segments.push(`prompt-${sanitizeSegment(meta.promptVersion)}`);
  } else {
    segments.push(sanitizeSegment(meta.profile));
  }

  return path.join(...segments);
}

/** Lista execN já usados; arquivos soltos na raiz contam como exec1 ocupado. */
export function listUsedExecIds(promptBaseDir: string): number[] {
  if (!fs.existsSync(promptBaseDir)) return [];

  const entries = fs.readdirSync(promptBaseDir, { withFileTypes: true });
  const ids: number[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const m = /^exec(\d+)$/.exec(entry.name);
      if (m) ids.push(Number(m[1]));
    }
  }

  const hasLegacyFiles = entries.some(
    (e) => e.isFile() && e.name.endsWith(".json"),
  );
  if (hasLegacyFiles && !ids.includes(1)) {
    ids.push(1);
  }

  return ids;
}

export function nextExecId(promptBaseDir: string): number {
  const used = listUsedExecIds(promptBaseDir);
  if (used.length === 0) return 1;
  return Math.max(...used) + 1;
}

/**
 * Diretório completo incluindo execN.
 * results/.../prompt-v1/exec2/
 */
export function buildResultDirectory(
  resultsRoot: string,
  meta: ResultSaveMeta,
): string {
  const base = buildPromptBaseDirectory(resultsRoot, meta);
  const execId = meta.execId ?? 1;
  return path.join(base, `exec${execId}`);
}

export function buildResultFileName(meta: ResultSaveMeta): string {
  const modelSafe = sanitizeSegment(meta.model.replace(/\//g, "_"));
  const tempStr = String(meta.temperature).replace(",", ".");
  const parts = [sanitizeSegment(meta.caseId), meta.profile];

  if (meta.runIndex != null && meta.runIndex >= 1) {
    parts.push(`run-${String(meta.runIndex).padStart(3, "0")}`);
  }

  parts.push(`temp-${tempStr}`, modelSafe, "response.json");
  return parts.join("-");
}

export function resolveResultsRoot(): string {
  const fromEnv = process.env.RESULTS_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, "../../../../../results");
}

export type ResultSaveOptions = {
  /** Imagem usada na análise; necessária para gerar pixels/ e scaled/. */
  imageBase64?: string;
  /** Gera anotações após salvar o JSON (padrão: true quando imageBase64 presente). */
  annotate?: boolean;
};

export class ResultWriter {
  /** Garante mesma exec por lote/requisição: domain/caseId/promptVersion */
  private readonly execCache = new Map<string, number>();

  constructor(
    private readonly resultsRoot: string = resolveResultsRoot(),
    private readonly annotationService = new ResultAnnotationService(),
  ) {}

  private execCacheKey(meta: ExecScopeMeta): string {
    return [
      meta.domain,
      meta.caseId,
      meta.profile,
      meta.promptVersion ?? "",
    ].join("|");
  }

  /** Próximo execN disponível para este escopo (nova execução de batch). */
  allocateExecId(meta: ExecScopeMeta): number {
    const base = buildPromptBaseDirectory(this.resultsRoot, meta);
    return nextExecId(base);
  }

  /** Reutiliza exec já reservado na mesma instância, ou aloca um novo. */
  resolveExecId(meta: ExecScopeMeta, explicit?: number): number {
    if (explicit != null && explicit >= 1) {
      const key = this.execCacheKey(meta);
      this.execCache.set(key, explicit);
      return explicit;
    }

    const key = this.execCacheKey(meta);
    const cached = this.execCache.get(key);
    if (cached != null) return cached;

    const id = this.allocateExecId(meta);
    this.execCache.set(key, id);
    return id;
  }

  buildAbsolutePath(meta: ResultSaveMeta): string {
    const execId = this.resolveExecId(meta, meta.execId);
    const dir = buildResultDirectory(this.resultsRoot, { ...meta, execId });
    return path.join(dir, buildResultFileName(meta));
  }

  async save(
    meta: ResultSaveMeta,
    result: {
      action: string;
      rationale: string;
      confidence: number;
      rawResponse: unknown;
      ui?: unknown;
    },
    options?: ResultSaveOptions,
  ): Promise<SavedResultPayload> {
    const promptVersion = meta.promptVersion
      ? normalizeAnalisysPromptVersion(String(meta.promptVersion))
      : meta.promptVersion;
    const normalizedMeta = { ...meta, promptVersion };
    const execId = this.resolveExecId(normalizedMeta, normalizedMeta.execId);
    const absolutePath = this.buildAbsolutePath({ ...normalizedMeta, execId });
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    const payload: SavedResultPayload = {
      ...normalizedMeta,
      execId,
      action: result.action,
      rationale: result.rationale,
      confidence: result.confidence,
      rawResponse: result.rawResponse,
      ui: result.ui,
      savedAt: new Date().toISOString(),
      savedPath: absolutePath,
    };

    fs.writeFileSync(absolutePath, JSON.stringify(payload, null, 2), "utf-8");

    const shouldAnnotate =
      options?.annotate !== false && Boolean(options?.imageBase64);
    if (shouldAnnotate && options?.imageBase64) {
      try {
        const dirs = await this.annotationService.annotateSavedResult(
          absolutePath,
          options.imageBase64,
        );
        if (dirs) {
          payload.annotationDirs = dirs;
          fs.writeFileSync(
            absolutePath,
            JSON.stringify(payload, null, 2),
            "utf-8",
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ResultWriter] Falha ao anotar ${absolutePath}: ${msg}`,
        );
      }
    }

    return payload;
  }
}
