import fs from "fs";
import path from "path";
import { parseCaseId, resolveFinalRoot } from "./FinalCaseCatalog";

export type ResolvedImageSource = {
  absolutePath: string;
  relativePath: string;
  caseId: string;
  testNumber: number | null;
  testVersion: string | null;
};

/**
 * Resolve caminho de imagem: absoluto, relativo ao cwd, relativo ao Final/ ou ao repo ICLLMs.
 */
export function resolveImagePath(input: string): ResolvedImageSource {
  const trimmed = input.trim();
  const finalRoot = resolveFinalRoot();
  const repoRoot = path.resolve(finalRoot, "..");

  const candidates = [
    path.resolve(trimmed),
    path.join(process.cwd(), trimmed),
    path.join(finalRoot, trimmed),
    path.join(repoRoot, trimmed),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const stem = path.parse(candidate).name;
      const { testNumber, testVersion } = parseCaseId(stem);
      let relativePath = trimmed;
      try {
        relativePath = path.relative(finalRoot, candidate);
        if (relativePath.startsWith("..")) {
          relativePath = path.relative(repoRoot, candidate);
        }
      } catch {
        relativePath = trimmed;
      }
      return {
        absolutePath: candidate,
        relativePath,
        caseId: stem,
        testNumber,
        testVersion,
      };
    }
  }

  throw new Error(
    `Imagem não encontrada: "${input}". Tentou: ${candidates.join(", ")}`,
  );
}

export function readImageFileAsDataUrl(absolutePath: string): string {
  const buf = fs.readFileSync(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
        : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
