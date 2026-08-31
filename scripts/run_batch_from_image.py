#!/usr/bin/env python3
"""
Gera N testes de cada versão de prompt Analysis a partir de UMA imagem (path).

Requer backend AnalisysLLMs_System rodando (Gemini via API).

Exemplos:
  python scripts/run_batch_from_image.py \\
    --image ../Final/LibreOffice/resized1920X1080/1v0a.png \\
    --runs 5 \\
    --prompt-versions v1

  python scripts/run_batch_from_image.py \\
    --image Final/Americanas/1bNossaLoja/1bNossaLoja.png \\
    --runs 3 \\
    --all-prompt-versions \\
    --domain Americanas
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def fetch_json(url: str, method: str = "GET", body: dict | None = None) -> dict:
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {e.code}: {detail}") from e


def resolve_image_path(raw: str) -> Path:
    p = Path(raw)
    if p.is_file():
        return p.resolve()

    script_dir = Path(__file__).resolve().parent
    system_root = script_dir.parent
    repo_root = system_root.parent

    for base in (Path.cwd(), repo_root, repo_root / "Final", system_root):
        candidate = (base / raw).resolve()
        if candidate.is_file():
            return candidate

    raise SystemExit(f"Imagem não encontrada: {raw}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="N testes × versão de prompt, mesma imagem, via Gemini (API)."
    )
    parser.add_argument(
        "--image",
        required=True,
        help="Caminho da imagem (absoluto ou relativo ao repo/Final)",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=1,
        help="Repetições por versão de prompt (N)",
    )
    parser.add_argument(
        "--prompt-versions",
        default="v1",
        help="Versões separadas por vírgula (ex.: v1,v2)",
    )
    parser.add_argument(
        "--all-prompt-versions",
        action="store_true",
        help="Usa todas as versões retornadas por /meta/analisys-prompts",
    )
    parser.add_argument("--domain", default=None, help="Domínio para pasta results/")
    parser.add_argument("--case-id", default=None, help="caseId (default: stem da imagem)")
    parser.add_argument("--temp", type=float, default=0.2)
    parser.add_argument("--model", default="gemini-2.5-flash")
    parser.add_argument(
        "--objective",
        default="Inventariar todos os componentes visíveis na interface.",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("API_BASE", "http://localhost:3000"),
    )
    parser.add_argument("--no-save", action="store_true")
    args = parser.parse_args()

    image_path = resolve_image_path(args.image)
    print(f"Imagem: {image_path}")

    prompt_versions: list[str]
    if args.all_prompt_versions:
        meta = fetch_json(f"{args.api_base}/meta/analisys-prompts")
        prompt_versions = meta.get("versions") or ["v1"]
    else:
        prompt_versions = [v.strip() for v in args.prompt_versions.split(",") if v.strip()]

    if args.runs < 1:
        raise SystemExit("--runs deve ser >= 1")

    body = {
        "imagePath": str(image_path),
        "domain": args.domain,
        "caseId": args.case_id or image_path.stem,
        "objective": args.objective,
        "models": [args.model],
        "LLMAPI": "GEMINI",
        "profiles": ["AnalisysComponentsLLM"],
        "temperature": args.temp,
        "promptVersions": prompt_versions,
        "runsPerVersion": args.runs,
        "saveToDisk": not args.no_save,
        "sessionId": f"batch-{image_path.stem}",
    }

    total = len(prompt_versions) * args.runs
    print(
        f"→ {total} requisições Gemini "
        f"({args.runs} runs × {len(prompt_versions)} versões: {', '.join(prompt_versions)})"
    )

    result = fetch_json(
        f"{args.api_base}/tests/final/run-batch",
        method="POST",
        body=body,
    )

    print(json.dumps(result, ensure_ascii=False, indent=2))

    saved = []
    for run in result.get("runs", []):
        saved.extend(run.get("savedPaths", []))

    if saved:
        print(f"\n✓ {len(saved)} arquivo(s) em results/:")
        for p in saved:
            print(f"  - {p}")


if __name__ == "__main__":
    main()
