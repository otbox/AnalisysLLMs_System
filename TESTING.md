# Esquema de testes — dataset Final

Testes reproduzíveis de `AnalisysComponentsLLM` usando **uma imagem** (path), com **N repetições por versão de prompt**, **temperature** e metadados no JSON/nome do arquivo.

## Fluxo principal

```
1 imagem (path)  →  N runs × cada promptVersion  →  Gemini  →  results/
```

Exemplo: `--runs 5` + `--all-prompt-versions` = **70 requisições** (5 runs × 14 versões).

## Versões de prompt AnalisysComponentsLLM

Todas as versões canônicas (consulte `GET /meta/analisys-prompts`) — **14 versões**:

| Versão | Descrição |
|--------|-----------|
| `v9` | Inventário completo em pixels (default produção) |
| `v8` | Detector normalizado 0–1000 (compacto, PT) |
| `v6pixels` | Análise completa em pixels |
| `v6pixels_tall` | Pixels, otimizado para screenshots altos |
| `v6PixelsEn` | Análise em pixels (inglês) |
| `v6` | Old analyser: normalizado 0–1000 + state/region/color |
| `v5scale` | Coordenadas normalizadas 0–1000 (compacto) |
| `v5scaleEn` | v5scale em inglês (legado) |
| `v5pixels` | Analyser pixels (geração anterior) |
| `v5pixelsold` | **Old analyser** pixels + state/region/color |
| `v3pixels` | Analyser legado coords 0–1000 + meta |
| `v1` | Batch PT: inventário completo com coordenadas |
| `v2` | Batch PT: JSON conciso sem coordenadas |
| `v3` | Batch PT: inventário mínimo compacto |

Pastas em `results/`: `prompt-v9/`, `prompt-v5pixelsold/`, `prompt-v3pixels/`, etc.

Se `promptVersions` for omitido no batch, **todas as 14 versões** são executadas.

## Estrutura de pastas

```
results/
└── <domínio>/
    └── <caseId>/
        └── prompt-<versão>/
            ├── exec1/          ← 1ª execução deste prompt
            │   ├── ...-run-001-....json
            │   └── ...-run-002-....json
            ├── exec2/          ← 2ª execução (nova rodada)
            └── exec3/
```

Cada **nova execução** (batch ou run único) aloca o próximo `execN` disponível.
Arquivos antigos soltos em `prompt-v1/` (sem pasta exec) contam como `exec1` já ocupado.

Exemplo:

```
results/Americanas/1bNossaLoja/prompt-v1/exec2/1bNossaLoja-AnalisysComponentsLLM-run-001-temp-0.2-gemini-2.5-flash-response.json
```

```
results/<domain>/<caseId>/prompt-<v>/exec<N>/<caseId>-AnalisysComponentsLLM-run-<NNN>-temp-<t>-<model>-response.json
```

Exemplo (2ª execução do prompt v1, run 3):

```
results/LibreOffice/1v0a/prompt-v1/exec2/1v0a-AnalisysComponentsLLM-run-003-temp-0.2-gemini-2.5-flash-response.json
```

Outros perfis (GuideLLM, etc.): `results/<domínio>/<caseId>/<profile>/exec<N>/`.

## Nome do arquivo salvo

## API

### Metadados de prompt

```bash
curl http://localhost:3000/meta/analisys-prompts
```

### Listar casos Final

```bash
curl "http://localhost:3000/tests/final/cases?domain=LibreOffice"
```

### Batch: N testes × versões, mesma imagem (recomendado)

```bash
curl -X POST http://localhost:3000/tests/final/run-batch \
  -H 'Content-Type: application/json' \
  -d '{
    "imagePath": "Final/LibreOffice/resized1920X1080/1v0a.png",
    "domain": "LibreOffice",
    "caseId": "1v0a",
    "runsPerVersion": 5,
    "promptVersions": ["v9", "v8", "v6pixels"],
    "LLMAPI": "GEMINI",
    "models": ["gemini-2.5-flash"],
    "temperature": 0.2,
    "saveToDisk": true
  }'
```

`imagePath` aceita:

- Caminho absoluto
- Relativo ao cwd
- Relativo a `Final/` ou à raiz do repo `ICLLMs/`

Alternativa sem path explícito (usa catálogo Final):

```json
{
  "domain": "LibreOffice",
  "caseId": "1v0a",
  "runsPerVersion": 3,
  "promptVersions": ["v1"]
}
```

### Run único

`POST /tests/final/run` — 1 requisição (ou batch se `runsPerVersion > 1` ou múltiplas versões).

## CLI Python (1 imagem → N × versões)

Com backend rodando (`yarn dev` em `backend/`):

```bash
cd AnalisysLLMs_System
python scripts/run_batch_from_image.py \
  --image Final/LibreOffice/resized1920X1080/1v0a.png \
  --runs 5 \
  --prompt-versions v9 \
  --temp 0.2
```

Várias versões:

```bash
python scripts/run_batch_from_image.py \
  --image ../Final/Americanas/1bNossaLoja/1bNossaLoja.png \
  --runs 3 \
  --prompt-versions v9,v8,v5scale \
  --domain Americanas
```

Todas as versões registradas:

```bash
python scripts/run_batch_from_image.py \
  --image Final/LibreOffice/1v0a.png \
  --runs 5 \
  --all-prompt-versions
```

## Shell

```bash
./scripts/run-final-test.sh \
  --image Final/LibreOffice/resized1920X1080/1v0a.png \
  --runs 5 \
  --prompt v9

./scripts/run-final-test.sh \
  --image Final/LibreOffice/1v0a.png \
  --runs 3 \
  --prompts v9,v8,v6pixels
```

## Frontend

Painel **Teste em lote (1 imagem → N × versões)**:

1. Cole o **caminho da imagem**
2. Defina **N** (repetições por versão)
3. Marque as **versões de prompt**
4. **Batch N×versões** (Gemini)

Ou use **Caso Final** + batch com a imagem do catálogo.

## Novas versões de prompt

Em `backend/src/core/services/llm/profiles/AnalisysProfiles.ts`:

1. Crie o template (ex.: `export const v10 = \`...\``)
2. Importe em `LLMsProfiles.ts` e adicione em `ANALISYS_PROMPT_VERSIONS` + `ANALISYS_BY_VERSION`
3. Rode batch com `"promptVersions": ["v10"]` ou `--all-prompt-versions`

## Variáveis de ambiente

| Var | Default |
|-----|---------|
| `FINAL_DATASET_PATH` | `../../Final` |
| `RESULTS_DIR` | `AnalisysLLMs_System/results` |
| `GOOGLE_API_KEY` | obrigatória para Gemini |
