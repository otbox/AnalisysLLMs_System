import fs from "fs";
import path from "path";

export type FinalDomain = "Americanas" | "Limeira" | "LibreOffice";

export type FinalCase = {
  domain: FinalDomain;
  caseId: string;
  /** Número do passo/teste (ex.: 1 em 1v0a). */
  testNumber: number | null;
  /** Sufixo de versão (ex.: v0a, bNossaLoja). */
  testVersion: string | null;
  imagePath: string;
  uiJsonPath: string | null;
  relativeImagePath: string;
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const SKIP_NAME = /^(annotated|anotad|captura|resized)/i;

export function resolveFinalRoot(): string {
  const fromEnv = process.env.FINAL_DATASET_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  // ICLLMs/Final a partir de AnalisysLLMs_System/backend/src/...
  return path.resolve(__dirname, "../../../../../../Final");
}

/**
 * Extrai número e versão de ids como 1v0a, 2v1c, 1bNossaLoja, 4b, 5v0c.
 */
export function parseCaseId(caseId: string): {
  testNumber: number | null;
  testVersion: string | null;
} {
  const m = /^(\d+)(.*)$/.exec(caseId.trim());
  if (!m) return { testNumber: null, testVersion: caseId || null };
  const testNumber = Number(m[1]);
  const rest = m[2] || null;
  return {
    testNumber: Number.isFinite(testNumber) ? testNumber : null,
    testVersion: rest,
  };
}

function pickPrimaryImage(dir: string, preferredStem?: string): string | null {
  const files = fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .filter((f) => !SKIP_NAME.test(f));

  if (files.length === 0) return null;

  if (preferredStem) {
    const exact = files.find(
      (f) => path.parse(f).name.toLowerCase() === preferredStem.toLowerCase(),
    );
    if (exact) return path.join(dir, exact);
  }

  // Prefer files that look like case ids over generic names
  const scored = files
    .map((f) => {
      const stem = path.parse(f).name;
      let score = 0;
      if (/^\d/.test(stem)) score += 2;
      if (/v\d/i.test(stem)) score += 1;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score || a.f.localeCompare(b.f));

  return path.join(dir, scored[0].f);
}

function findUiJson(dir: string): string | null {
  const candidates = [
    "estrutura_ui.json",
    "adjusted_ui.json",
    "ui_structure.json",
  ];
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function caseFromDir(
  domain: FinalDomain,
  caseId: string,
  dir: string,
  finalRoot: string,
): FinalCase | null {
  const imagePath = pickPrimaryImage(dir, caseId);
  if (!imagePath) return null;
  const { testNumber, testVersion } = parseCaseId(caseId);
  return {
    domain,
    caseId,
    testNumber,
    testVersion,
    imagePath,
    uiJsonPath: findUiJson(dir),
    relativeImagePath: path.relative(finalRoot, imagePath),
  };
}

function scanLibreOffice(finalRoot: string): FinalCase[] {
  const domain: FinalDomain = "LibreOffice";
  const cases: FinalCase[] = [];
  const base = path.join(finalRoot, "LibreOffice");
  if (!fs.existsSync(base)) return cases;

  const preferred = path.join(base, "resized1920X1080");
  const searchDirs = [preferred, base].filter((d) => fs.existsSync(d));

  const seen = new Set<string>();
  for (const dir of searchDirs) {
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      if (SKIP_NAME.test(file)) continue;
      const caseId = path.parse(file).name;
      if (seen.has(caseId)) continue;
      // skip duplicates like 0parte2(1)
      if (/\(\d+\)$/.test(caseId)) continue;
      seen.add(caseId);
      const { testNumber, testVersion } = parseCaseId(caseId);
      const imagePath = path.join(dir, file);
      cases.push({
        domain,
        caseId,
        testNumber,
        testVersion,
        imagePath,
        uiJsonPath: null,
        relativeImagePath: path.relative(finalRoot, imagePath),
      });
    }
  }
  return cases;
}

function scanFolderDomain(
  finalRoot: string,
  domain: FinalDomain,
): FinalCase[] {
  const base = path.join(finalRoot, domain);
  if (!fs.existsSync(base)) return [];
  const cases: FinalCase[] = [];

  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "libreoffice" || entry.name.startsWith(".")) continue;
    const dir = path.join(base, entry.name);
    const c = caseFromDir(domain, entry.name, dir, finalRoot);
    if (c) cases.push(c);
  }
  return cases;
}

export class FinalCaseCatalog {
  constructor(private readonly finalRoot: string = resolveFinalRoot()) {}

  list(domain?: FinalDomain): FinalCase[] {
    const domains: FinalDomain[] = domain
      ? [domain]
      : ["Americanas", "Limeira", "LibreOffice"];

    const all: FinalCase[] = [];
    for (const d of domains) {
      if (d === "LibreOffice") {
        all.push(...scanLibreOffice(this.finalRoot));
      } else {
        all.push(...scanFolderDomain(this.finalRoot, d));
      }
    }

    return all.sort((a, b) => {
      const dn = a.domain.localeCompare(b.domain);
      if (dn !== 0) return dn;
      const na = a.testNumber ?? 9999;
      const nb = b.testNumber ?? 9999;
      if (na !== nb) return na - nb;
      return a.caseId.localeCompare(b.caseId);
    });
  }

  find(domain: FinalDomain, caseId: string): FinalCase | null {
    return (
      this.list(domain).find(
        (c) => c.caseId === caseId || c.caseId.toLowerCase() === caseId.toLowerCase(),
      ) ?? null
    );
  }

  /**
   * Filtra por número e/ou versão do caso (ex.: number=2, version=v0a → 2v0a).
   */
  filterByNumberVersion(
    domain: FinalDomain | undefined,
    testNumber?: number,
    testVersion?: string,
  ): FinalCase[] {
    return this.list(domain).filter((c) => {
      if (testNumber != null && c.testNumber !== testNumber) return false;
      if (testVersion != null && testVersion !== "") {
        const tv = testVersion.startsWith("v")
          ? testVersion
          : testVersion.match(/^[0-9]/)
            ? `v${testVersion}`
            : testVersion;
        const cand = c.testVersion ?? "";
        if (
          cand !== testVersion &&
          cand !== tv &&
          !cand.toLowerCase().startsWith(testVersion.toLowerCase())
        ) {
          return false;
        }
      }
      return true;
    });
  }

  readImageAsDataUrl(imagePath: string): string {
    const buf = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  readUiJson(uiJsonPath: string | null): string | undefined {
    if (!uiJsonPath || !fs.existsSync(uiJsonPath)) return undefined;
    return fs.readFileSync(uiJsonPath, "utf-8");
  }
}
