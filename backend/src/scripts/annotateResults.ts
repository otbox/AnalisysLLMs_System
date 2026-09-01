/**
 * Gera pixels/ e scaled/ para JSONs já salvos em results/ (sem chamar LLM).
 *
 * Uso:
 *   npx ts-node --transpile-only src/scripts/annotateResults.ts [resultsRoot]
 *   npx ts-node --transpile-only src/scripts/annotateResults.ts --force
 */
import path from "path";
import fs from "fs";
import { ResultAnnotationService } from "../core/services/results/ResultAnnotationService";
import { resolveResultsRoot } from "../core/services/results/ResultWriter";

function collectResponseJsonFiles(root: string): string[] {
  const out: string[] = [];

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

  walk(root);
  return out.sort();
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const rootArg = args.find((a) => !a.startsWith("--"));
  const resultsRoot = path.resolve(rootArg ?? resolveResultsRoot());

  const files = collectResponseJsonFiles(resultsRoot);
  if (!files.length) {
    console.log(`Nenhum *-response.json em ${resultsRoot}`);
    return;
  }

  const service = new ResultAnnotationService();
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Anotando ${files.length} arquivo(s) em ${resultsRoot}...`);

  for (const jsonPath of files) {
    try {
      const result = await service.annotateSavedResult(jsonPath, undefined, {
        force,
      });
      if (!result) {
        skipped += 1;
        console.log(`⊘ sem UI: ${jsonPath}`);
        continue;
      }
      ok += 1;
      console.log(`✓ ${path.basename(jsonPath)} → ${result.pixelsDir}`);
    } catch (err: unknown) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${jsonPath}: ${msg}`);
    }
  }

  console.log(
    `Concluído: ${ok} anotado(s), ${skipped} sem UI, ${failed} erro(s).`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
