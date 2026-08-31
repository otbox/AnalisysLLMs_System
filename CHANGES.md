# Sessão de Refatoração — Resumo para Reunião

> **Data da sessão:** 06–07 Mai 2026  
> **Repositório:** `AnalisysLLMs_System`  
> **Commits desta sessão:** [`6c88268`](https://github.com/otbox/AnalisysLLMs_System/commit/6c8826827179b71f218c3223819a09b2d051cdf8) · [`1870adb`](https://github.com/otbox/AnalisysLLMs_System/commit/1870adbba8e5b7ebe4e263c24610cd795e3febf9) · [`7ac6707`](https://github.com/otbox/AnalisysLLMs_System/commit/7ac6707497f46f73eb9d8892dd92a55f3cf3cbe4)

---

## 1. Contexto

O sistema envia screenshots de interfaces para modelos LLM (Gemini, Ollama, OpenRouter), recebe de volta um JSON com elementos de UI e suas coordenadas de bounding box, e então desenha as caixas sobre a imagem original para visualização e auditoria.

O problema principal era que **as caixas desenhadas pelo backend estavam sistematicamente erradas ou faltando**, enquanto o frontend anotava corretamente.

---

## 2. Problemas Encontrados

### 2.1 Dimensões hardcoded nos prompts

Todos os prompts de análise (`v6pixels`, `v5pixels`, `v6PixelsEn` etc.) tinham as dimensões da imagem **escritas literalmente** no texto:

```
Image resolution: EXACTLY 1920 × 1080 pixels
0 ≤ x < 1920
y + h ≤ 1080
```

Quando a imagem real tinha outra resolução (ex.: `1065 × 1080`), o modelo retornava coordenadas calibradas para `1920 × 1080` — as caixas ficavam **deslocadas para a direita e cortadas**.

### 2.2 Nenhuma leitura real das dimensões da imagem

O `GoogleService` e o `OllamaService` recebiam o `imageBase64` mas **nunca liam os bytes da imagem** para extrair `width` e `height`. Não havia nenhum utilitário no projeto para isso.

### 2.3 `data.output` passado ao anotador em vez de `data.full[]`

No `LLMController`, o `saveDualImages` recebia o objeto bruto retornado pelo `GoogleService`:

```ts
analysis: data.output as any
// = { action, rationale, rawResponse: { candidates: [...] } }
```

O `extractUiElements()` não encontrava `ui`, `elements` ou `full` nesse objeto. Caía no fallback de parsear `rawResponse.candidates[0].content.parts[0].text` — que muitas vezes falhava silenciosamente. Resultado: **imagens salvas sem nenhuma anotação**.

### 2.4 `defaultCoordScale` errado no controller

O `StepController` tinha:

```ts
private readonly defaultCoordScale: CoordScale = "normalized-1000";
```

Mas o perfil ativo (`AnalisysComponentsLLM` → `v6pixels`) instrui o modelo a retornar **pixels absolutos**. Com `normalized-1000`, o `resolveAbsoluteBoxes` dividia as coordenadas por 1000 e multiplicava pelas dimensões — as caixas ficavam **minúsculas no canto superior esquerdo**.

### 2.5 Dual save salvava duas versões idênticas ("scaled")

A implementação anterior do dual save gerava:
- `pixels/` → imagem original com caixas absolutas.
- `scaled/` → imagem redimensionada para viewport com caixas proporcionais.

Ambas eram variações da **mesma interpretação de coordenada**, não cobrindo os diferentes modos de conversão. Era impossível comparar visualmente se o modelo errou a escala ou se foi o pipeline que converteu errado.

---

## 3. Soluções Propostas e Aplicadas

### 3.1 `promptUtils.ts` — utilitário de leitura de dimensões e interpolação

**Solução:** criar dois utilitários puros sem dependências externas.

```
backend/src/core/services/llm/promptUtils.ts
```

- **`resolveImageDimensions(base64)`** — lê o header binário do buffer para extrair `width × height` sem usar `sharp` ou qualquer lib:
  - PNG: bytes 16–23 (big-endian uint32).
  - JPEG: varre marcadores SOF0/SOF1/SOF2.
  - WEBP: detecta variantes VP8, VP8L e VP8X.

- **`interpolatePrompt(template, vars)`** — substitui tokens `{{CHAVE}}` no texto do prompt com os valores fornecidos.

**Por que dessa forma:** não faz sentido adicionar uma dependência extra (ex.: `probe-image-size`) só para ler 4 bytes de header. O parser manual é ~60 linhas e cobre os 3 formatos relevantes. A interpolação com `{{TOKEN}}` é o padrão mais simples e legível para templates de prompt — fácil de adicionar novos parâmetros no futuro.

---

### 3.2 `AnalisysProfiles.ts` — placeholders em todos os prompts

**Solução:** substituir todas as dimensões hardcoded por placeholders:

```
backend/src/core/services/llm/profiles/AnalisysProfiles.ts
```

```
Image resolution: EXACTLY {{IMAGE_WIDTH}} × {{IMAGE_HEIGHT}} pixels
0 ≤ x < {{IMAGE_WIDTH}}
y + h ≤ {{IMAGE_HEIGHT}}
```

Os prompts **não mudam de comportamento** — apenas deixam de ter valores fixos. A resolução real é injetada em tempo de execução.

**Por que dessa forma:** centralizar o dado na origem (a imagem) em vez de manter um valor fixo no código. Qualquer screenshot de qualquer resolução passa a ser tratado corretamente sem alteração de código.

---

### 3.3 `GoogleService.ts` e `OllamaService.ts` — injeção automática

**Solução:** antes de montar o `systemInstruction`, ambos os serviços agora fazem:

```ts
const dims = resolveImageDimensions(input.imageBase64);
const systemPrompt = interpolatePrompt(rawTemplate, {
  IMAGE_WIDTH:  dims.width,
  IMAGE_HEIGHT: dims.height,
});
```

Log emitido a cada chamada para rastreabilidade:
```
[GoogleService] Image dimensions: 1065×1080 | Profile: AnalisysComponentsLLM
```

**Por que dessa forma:** a responsabilidade de saber as dimensões da imagem é do serviço que **tem** a imagem — não do perfil de prompt. Separação clara de responsabilidades.

---

### 3.4 `LLMController.ts` — corrigir `analysis` e `coordScale`

**Solução:**

1. `saveQuadImages` recebe `uiElements: unknown[]` (o `full[]` já parseado) e passa `{ ui: uiElements }` ao anotador — caminho direto sem fallbacks.
2. Removido o `coordScale` como parâmetro do controller (agora é implícito ao perfil ativo).

**Por que dessa forma:** o `full[]` já é o array de `UiElement` parseados pelo `QueueService`. Passar o objeto bruto e depender de fallbacks frágeis era uma fonte constante de anotações vazias silenciosas.

---

### 3.5 `ImageAnnotationScale.ts` — 4 modos de anotação (`annotateQuad`)

**Solução:** substituir o dual save por um **quad save** com 4 variantes cobrindo todos os modos de interpretação de coordenada:

```
backend/src/core/services/ImageAnnotationScale.ts
```

| Modo | Fórmula | Quando é o "correto" |
|------|---------|----------------------|
| **A** `pixels_pure` | coords do JSON → clamp direto | LLM retornou pixels reais |
| **B** `pixels_via_norm` | `px ÷ imgW × 1000 ÷ 1000 × imgW` | Round-trip de verificação |
| **C** `norm1000_correct` | `norm ÷ 1000 × imgW` | LLM retornou 0–1000 |
| **D** `norm1000_raw` | `px ÷ 1000 × imgW` (sem dividir) | Visualização do bug |

A ÷ B deve ser visualmente idêntico — diferença de arredondamento apenas. D vai produzir caixas minúsculas no canto superior esquerdo, revelando exatamente o que acontecia antes das correções.

**Por que dessa forma:** ter as 4 variantes salvas lado a lado permite auditoria visual imediata. Se o modelo errou a escala, fica visível comparando A e C. Se o pipeline estava convertendo errado, D mostra esse estado para histórico.

---

## 4. Estrutura de Arquivos — Backend

```
backend/src/core/
│
├── controllers/
│   └── LLMController.ts
│       Recebe a requisição HTTP POST /sessions/:id/steps.
│       Orquestra: fila → LLM → save JSON + quad images.
│       Chama saveQuadImages() com os elementos já parseados (full[]).
│
└── services/
    │
    ├── ImageAnnotationScale.ts
    │   Serviço de anotação visual.
    │   annotateQuad()  → produz 4 PNGs (modos A/B/C/D).
    │   annotateDual()  → API legada (pixels + scaled), mantida para compat.
    │   Toda lógica de desenho SVG e composição com sharp está aqui.
    │
    ├── QueueService.ts
    │   Fila de execução dos jobs LLM.
    │   Retorna { output, full[], clean[] } para o controller.
    │
    ├── ErrorHandler.ts
    │   Classifica erros da API LLM em categorias padronizadas.
    │
    └── llm/
        │
        ├── ILLMService.ts
        │   Interface comum: StepModelInput / StepModelOutput / LLMClient.
        │   Contrato que GoogleService e OllamaService implementam.
        │
        ├── GoogleService.ts
        │   Client Gemini (google/generative-ai).
        │   Resolve dimensões → interpola prompt → chama API → salva resposta.
        │
        ├── OllamaService.ts
        │   Client Ollama (fetch local).
        │   Mesmo fluxo de injeção de dimensões que o GoogleService.
        │
        ├── LLMsProfiles.ts
        │   Mapa ProfileKey → template de prompt.
        │   Os valores são strings com {{IMAGE_WIDTH}}/{{IMAGE_HEIGHT}}.
        │   NÃO resolve os tokens — isso é responsabilidade dos services.
        │
        ├── promptUtils.ts          ← NOVO
        │   resolveImageDimensions(base64) — lê header PNG/JPEG/WEBP.
        │   interpolatePrompt(template, vars) — substitui {{TOKEN}}.
        │
        └── profiles/
            └── AnalisysProfiles.ts
                Strings de prompt organizadas por versão (v6pixels, v8, v5scale…).
                Todas usam {{IMAGE_WIDTH}} e {{IMAGE_HEIGHT}} onde aplicável.
                Aliases legados mantidos (v5pixels, v3pixels, v6) para não quebrar
                código existente que referencia os nomes antigos.
```

---

## 5. Estrutura de Saída por Análise

```
output/
└── {fileName}/
    └── step{N}/
        └── {profile}-{model}/
            ├── output.json              ← resposta bruta do LLM
            ├── full.json                ← todos os elementos parseados
            ├── clean.json               ← elementos filtrados
            │
            ├── pixels/
            │   ├── A_pixels_pure.png           ← coords em pixels, direto
            │   ├── A_pixels_pure_labels.png
            │   ├── B_pixels_via_norm.png        ← round-trip via 0-1000
            │   └── B_pixels_via_norm_labels.png
            │
            └── normalized/
                ├── C_norm1000_correct.png       ← 0-1000 convertido certo
                ├── C_norm1000_correct_labels.png
                ├── D_norm1000_raw.png           ← pixels como 0-1000 (bug)
                └── D_norm1000_raw_labels.png
```

---

## 6. Fluxo Completo (após as mudanças)

```
Frontend
  └─ POST /sessions/:id/steps
       { imageBase64, profiles, models, objective, ... }
            │
            ▼
     LLMController
       ├─ QueueService.enqueue()
       │       │
       │       ▼
       │   GoogleService / OllamaService
       │     1. resolveImageDimensions(imageBase64)
       │        → lê header PNG/JPEG → { width, height }
       │     2. interpolatePrompt(template, { IMAGE_WIDTH, IMAGE_HEIGHT })
       │        → substitui {{TOKEN}} no prompt
       │     3. Chama API LLM com systemInstruction já com dimensões reais
       │     4. Retorna { output, full[], clean[] }
       │
       └─ saveResults()
             ├─ output.json / full.json / clean.json
             └─ saveQuadImages(imageBase64, full[])
                   └─ annotateQuad()
                         ├─ A: pixels puro
                         ├─ B: pixels → norm → pixels
                         ├─ C: norm-1000 correto
                         └─ D: pixels como norm (bug)
```

---

*Documento gerado em 07/05/2026.*
