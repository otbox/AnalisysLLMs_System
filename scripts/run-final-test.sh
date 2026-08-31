#!/usr/bin/env bash
# N testes × versão de prompt a partir de uma imagem (path).
# Requer backend rodando.
#
#   ./scripts/run-final-test.sh --image Final/LibreOffice/resized1920X1080/1v0a.png --runs 5
#   ./scripts/run-final-test.sh --image ../Final/LibreOffice/1v0a.png --runs 3 --prompt v1,v2

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
IMAGE_PATH=""
DOMAIN=""
CASE_ID=""
TEST_NUMBER=""
TEST_VERSION=""
PROMPT_VERSION="v1"
PROMPT_VERSIONS=""
RUNS="1"
TEMPERATURE="0.2"
LLMAPI="GEMINI"
MODEL="gemini-2.5-flash"
OBJECTIVE="Inventariar todos os componentes visíveis na interface."
INCLUDE_UI_JSON="false"
ALL_PROMPTS="false"

usage() {
  sed -n '2,10p' "$0"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE_PATH="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --case) CASE_ID="$2"; shift 2 ;;
    --number) TEST_NUMBER="$2"; shift 2 ;;
    --version) TEST_VERSION="$2"; shift 2 ;;
    --prompt) PROMPT_VERSION="$2"; shift 2 ;;
    --prompts) PROMPT_VERSIONS="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --all-prompts) ALL_PROMPTS="true"; shift ;;
    --temp) TEMPERATURE="$2"; shift 2 ;;
    --api) LLMAPI="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --objective) OBJECTIVE="$2"; shift 2 ;;
    --with-json) INCLUDE_UI_JSON="true"; shift ;;
    --base) API_BASE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Arg desconhecido: $1"; usage ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSTEM_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SYSTEM_ROOT/.." && pwd)"

resolve_image() {
  local raw="$1"
  if [[ -f "$raw" ]]; then echo "$(cd "$(dirname "$raw")" && pwd)/$(basename "$raw")"; return; fi
  for base in "$PWD" "$REPO_ROOT" "$REPO_ROOT/Final" "$SYSTEM_ROOT"; do
    if [[ -f "$base/$raw" ]]; then echo "$(cd "$base" && pwd)/${raw#*/}"; return; fi
    if [[ -f "$base/$raw" ]]; then echo "$base/$raw"; return; fi
  done
  echo "Imagem não encontrada: $raw" >&2
  exit 1
}

if [[ -n "$IMAGE_PATH" ]]; then
  ABS_IMAGE="$(resolve_image "$IMAGE_PATH")"
  PROMPTS_JSON="[\"$PROMPT_VERSION\"]"
  if [[ -n "$PROMPT_VERSIONS" ]]; then
    PROMPTS_JSON=$(python3 - <<PY
import json
print(json.dumps([p.strip() for p in "$PROMPT_VERSIONS".split(",") if p.strip()]))
PY
)
  elif [[ "$ALL_PROMPTS" == "true" ]]; then
    PROMPTS_JSON=$(curl -sS "$API_BASE/meta/analisys-prompts" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin).get('versions',['v1'])))")
  fi

  BODY=$(python3 - <<PY
import json
body = {
  "imagePath": """$ABS_IMAGE""",
  "objective": """$OBJECTIVE""",
  "models": ["$MODEL"],
  "LLMAPI": "$LLMAPI",
  "profiles": ["AnalisysComponentsLLM"],
  "temperature": float("$TEMPERATURE"),
  "promptVersions": $PROMPTS_JSON,
  "runsPerVersion": int("$RUNS"),
  "saveToDisk": True,
}
if """$DOMAIN""":
  body["domain"] = """$DOMAIN"""
if """$CASE_ID""":
  body["caseId"] = """$CASE_ID"""
print(json.dumps(body, ensure_ascii=False))
PY
)
  echo "→ POST $API_BASE/tests/final/run-batch ($RUNS runs × prompts)"
  echo "$BODY" | python3 -m json.tool
  curl -sS -X POST "$API_BASE/tests/final/run-batch" \
    -H "Content-Type: application/json" \
    -d "$BODY" | python3 -m json.tool
  exit 0
fi

if [[ -z "$DOMAIN" ]]; then
  echo "Informe --image <path> OU --domain Americanas|Limeira|LibreOffice"
  exit 1
fi

PROMPTS_ARG=""
if [[ -n "$PROMPT_VERSIONS" ]]; then
  PROMPTS_ARG=$(python3 - <<PY
import json
print(json.dumps([p.strip() for p in "$PROMPT_VERSIONS".split(",") if p.strip()]))
PY
)
fi

BODY=$(python3 - <<PY
import json
body = {
  "domain": "$DOMAIN",
  "objective": """$OBJECTIVE""",
  "models": ["$MODEL"],
  "LLMAPI": "$LLMAPI",
  "profiles": ["AnalisysComponentsLLM"],
  "temperature": float("$TEMPERATURE"),
  "runsPerVersion": int("$RUNS"),
  "includeUiJson": $INCLUDE_UI_JSON,
  "saveToDisk": True,
}
if """$CASE_ID""":
  body["caseId"] = """$CASE_ID"""
num = "$TEST_NUMBER"
ver = "$TEST_VERSION"
if num:
  body["testNumber"] = int(num)
if ver:
  body["testVersion"] = ver
if """$PROMPTS_ARG""":
  body["promptVersions"] = $PROMPTS_ARG
else:
  body["promptVersion"] = "$PROMPT_VERSION"
print(json.dumps(body, ensure_ascii=False))
PY
)

ENDPOINT="/tests/final/run"
if [[ "$RUNS" -gt 1 ]] || [[ -n "$PROMPTS_ARG" ]]; then
  ENDPOINT="/tests/final/run-batch"
fi

echo "→ POST $API_BASE$ENDPOINT"
echo "$BODY" | python3 -m json.tool

curl -sS -X POST "$API_BASE$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$BODY" | python3 -m json.tool
