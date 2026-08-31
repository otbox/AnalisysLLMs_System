# AnalisysLLMs_System

Submódulo do [ICLLMs](../) para **testar capacidades de LLMs** em leitura/interpretação de interfaces: imagem de tela, com ou sem JSON estrutural, visando sugerir o próximo passo e avaliar usabilidade.

Repositório remoto: [github.com/otbox/AnalisysLLMs_System](https://github.com/otbox/AnalisysLLMs_System)

---

## Visão geral

| Camada | Stack | Papel |
|--------|--------|--------|
| `backend/` | Fastify, TypeScript, Zod | API multimodelo (OpenRouter, Gemini, NVIDIA) |
| `frontend/` | React 19, Vite, TypeScript | Painel de teste (upload, perfis, resultados) |
| `results/` | JSON + `ContadorDeComponents.py` | Saídas experimentais e relatórios |

```
AnalisysLLMs_System/
├── backend/
│   ├── src/
│   │   ├── app/server.ts          # Entrada HTTP (rotas)
│   │   ├── app/routes/routes.ts   # Placeholder de rotas
│   │   ├── config/di-container.ts # Injeção de dependências
│   │   ├── core/controllers/      # LLMController, NvidiaController
│   │   └── core/services/llm/     # Clientes e perfis de prompt
│   ├── diagram/backend.puml
│   └── package.json
├── frontend/
│   └── src/App.tsx                # UI principal de testes
├── results/
│   ├── Americanas/
│   ├── PrefeituraLimeira/
│   ├── LibreOffice/
│   ├── ResultadosMultiplasLLMsParaTeste/
│   └── ContadorDeComponents.py
├── LICENSE
└── README.md
```

---

## Esquema de testes (Final)

Ver **[TESTING.md](./TESTING.md)** — listar/rodar casos de `../Final` por número+versão, com `promptVersion` e `temperature` explícitos no JSON e no nome do arquivo em `results/`.

Endpoints: `GET /tests/final/cases`, `POST /tests/final/run`, `GET /meta/analisys-prompts`.

---

## Pré-requisitos

- Node.js 18+ e Yarn (ou npm)
- Chaves de API conforme o provedor usado

### Variáveis de ambiente

**Backend** (`backend/.env`):

```env
PORT=3000
OPEN_ROUTER_API_KEY=...
# Chaves Gemini / NVIDIA conforme GoogleService e NvidiaService
```

**Frontend** (`frontend/.env`):

```env
VITE_API_BASE_URL=http://localhost:3000
```

---

## Como subir

```bash
# Backend
cd backend
yarn install
yarn dev          # ts-node-dev → src/app/server.ts

# Frontend (outro terminal)
cd frontend
yarn install
yarn dev          # Vite, tipicamente :5173
```

Produção backend:

```bash
cd backend
yarn build
yarn start        # node src/index.js
```

---

## API (backend)

Base: `http://localhost:3000` (ou `PORT`).

### `GET /openrouter/models`

Lista modelos habilitados em `LLMModesAvaible.ts` (atualmente foco em free VLMs no OpenRouter).

### `POST /sessions/:sessionId/steps`

Corpo típico:

```json
{
  "LLMAPI": "GEMINI",
  "models": ["gemini-2.5-flash"],
  "objective": "Comprar brinquedo de dinossauro entre 100 e 250 reais",
  "stepIndex": 1,
  "imageBase64": "<base64 da screenshot>",
  "uiJson": "{ ... opcional ... }",
  "historySummary": "",
  "profiles": ["AnalisysComponentsLLM"]
}
```

`LLMAPI`: `"OPENROUTER"` | `"GEMINI"`.

Resposta: `{ sessionId, stepIndex, objective, results[] }` com `profile`, `model`, ação/rationale/confidence (quando o schema se aplica) e `rawResponse`.

### `POST /analisysNvidia`

Detecção de elementos de página via NVIDIA (nemoretriever / object detection).

```json
{
  "imageBase64": "...",
  "maxDetections": 50,
  "confidenceThreshold": 0.5
}
```

---

## Arquivos do backend (script a script)

### Entrada e infra

| Arquivo | Descrição |
|---------|-----------|
| `src/app/server.ts` | Sobe Fastify, CORS, body até 10 MB; registra rotas de steps, models e NVIDIA |
| `src/config/di-container.ts` | Monta `StepController` com serviços Analysis / Guide / Cognitive (cliente OpenRouter por padrão no container) |
| `src/index.ts` / `index.js` | Entry de build/start |
| `src/app/routes/routes.ts` | Arquivo vazio (rotas estão inline em `server.ts`) |
| `diagram/backend.puml` | Diagrama UML: `ILLMService` → perfis Cognitive / Guide / Analysis |

### Controllers

| Arquivo | Descrição |
|---------|-----------|
| `core/controllers/LLMController.ts` | `StepController`: para cada `profile` × `model`, chama o serviço correspondente e agrega resultados |
| `core/controllers/NvidiaController.ts` | Valida `imageBase64` e delega ao `NvidiaObjectDetectionService` |

### Serviços LLM

| Arquivo | Descrição |
|---------|-----------|
| `ILLMService.ts` | Contrato `LLMClient` / tipos de input-output do step |
| `LLMsProfiles.ts` | System prompts dos 3 perfis (`GuideLLM`, `AnalisysComponentsLLM`, `CongnitiveWalktroughLLM`) |
| `LLMModesAvaible.ts` | Catálogo de modelos OpenRouter expostos ao frontend |
| `AnalisisLLM.ts` | Serviço de inventário / análise de componentes |
| `GuideStepLLM.ts` | Serviço de orientação do próximo passo |
| `OpenRouterService.ts` | Cliente OpenRouter multimodal (imagem + texto); schema JSON de decisão de step |
| `GoogleService.ts` | Cliente Google Generative AI (Gemini) |
| `utils.ts` | Placeholder |
| `nvidia/NvidiaService.ts` | Orquestra detecção NVIDIA |
| `nvidia/NvidiaObjectDetectionClient.ts` | Chamada HTTP/SDK ao modelo de page elements |

### Perfis de prompt (`LLMsProfiles.ts`)

1. **GuideLLM** — associa objetivo + UI à próxima ação concreta (clicar, preencher, etc.).
2. **AnalisysComponentsLLM** — devolve **somente JSON** com lista de componentes (`id`, `type`, `text`, `state`, `region`, coordenadas, `actions`, `meta`).
3. **CongnitiveWalktroughLLM** — aplica perguntas clássicas do percurso cognitivo antes/depois da ação; sugere melhorias de UX.

---

## Frontend

Template Vite + React; a lógica de produto está em `src/App.tsx` (`LlmTesterPage`).

**Capacidades da UI:**

- Escolher provedor: Gemini, OpenRouter ou NVIDIA  
- Selecionar um ou mais **profiles** e **models**  
- Informar `sessionId`, objetivo e índice do passo  
- Upload de imagem (convertida para base64) e JSON opcional de UI  
- Exibir respostas, parsear inventário de componentes a partir de `rawResponse`  
- Tema claro/escuro  

Scripts:

```bash
yarn dev      # desenvolvimento
yarn build    # tsc + vite build
yarn preview  # preview da build
yarn lint     # ESLint
```

`frontend/README.md` é o README padrão do template Vite (não descreve o domínio IC).

Artefatos auxiliares na pasta frontend:

- `LLM Testing Frontend.html` — protótipo/estático  
- `CongnitiveWalktroughLLM-allenai_molmo-2-8b_free-response.json` — amostra de resposta  

---

## `results/`

Saídas salvas de experimentos, organizadas por domínio e passo (ex.: `Americanas/2v0a/...`, `LibreOffice/3v1c/...`, `PrefeituraLimeira/Noticias/...`).

Padrão de nome frequente:

```
*AnalisysComponentsLLM-gemini-2.5-flash-response.json
```

Há também `relatorio_componentes.json` por domínio e a pasta `ResultadosMultiplasLLMsParaTeste/` com comparações entre modelos (Molmo, Gemini, Nemotron, Qwen, etc.).

### `results/ContadorDeComponents.py`

Conta componentes em respostas de LLM:

- Regra: todo objeto com `id` **e** `type` conta 1  
- Aceita `ui`, texto JSON em `rawResponse` (Gemini/OpenRouter) e formatos com `ui_structure`/`filhos`  
- Gera relatório agregando arquivos sob uma pasta raiz  

```bash
cd results
python ContadorDeComponents.py
```

(Ajuste o diretório no `__main__` se necessário.)

---

## Fluxo de uso com o ICLLMs pai

1. Extraia UI no repositório pai (`testeweb.py` ou `libreoffice/teste.py`).  
2. Use screenshot (+ JSON) neste frontend/API.  
3. Escolha perfil `AnalisysComponentsLLM` ou `GuideLLM` conforme o experimento.  
4. Persista a resposta em `results/` e conte com `ContadorDeComponents.py`.  
5. Compare com o dataset anotado em `../Final/`.

---

## Licença

Ver arquivo [LICENSE](./LICENSE) neste submódulo.
