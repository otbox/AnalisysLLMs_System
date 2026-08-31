# Esquema de testes — dataset Final

Testes reproduzíveis de `AnalisysComponentsLLM` usando **uma imagem** (path), com **N repetições por versão de prompt**, **temperature** e metadados no JSON/nome do arquivo.

## Fluxo principal

```
1 imagem (path)  →  N runs × cada promptVersion  →  Gemini  →  results/
```

Exemplo: `--runs 5` + `promptVersions: [v1, v2]` = **10 requisições** com a mesma imagem.

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
    "promptVersions": ["v1"],
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
  --prompt-versions v1 \
  --temp 0.2
```

Várias versões:

```bash
python scripts/run_batch_from_image.py \
  --image ../Final/Americanas/1bNossaLoja/1bNossaLoja.png \
  --runs 3 \
  --prompt-versions v1,v2 \
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
  --prompt v1

./scripts/run-final-test.sh \
  --image Final/LibreOffice/1v0a.png \
  --runs 3 \
  --prompts v1,v2
```

## Frontend

Painel **Teste em lote (1 imagem → N × versões)**:

1. Cole o **caminho da imagem**
2. Defina **N** (repetições por versão)
3. Marque as **versões de prompt**
4. **Batch N×versões** (Gemini)

Ou use **Caso Final** + batch com a imagem do catálogo.

## Novas versões de prompt

Em `backend/src/core/services/llm/LLMsProfiles.ts`:

1. Adicione `"v2"` em `AnalisysPromptVersion` e `ANALISYS_PROMPT_VERSIONS`
2. Texto em `AnalisysComponentsPrompts.v2`
3. Rode batch com `"promptVersions": ["v1", "v2"]`

## Variáveis de ambiente

| Var | Default |
|-----|---------|
| `FINAL_DATASET_PATH` | `../../Final` |
| `RESULTS_DIR` | `AnalisysLLMs_System/results` |
| `GOOGLE_API_KEY` | obrigatória para Gemini |
