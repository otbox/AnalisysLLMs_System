# Annotation Modes — Documentação Técnica

> Arquivo: `backend/src/core/services/ImageAnnotationScale.ts`  
> Método principal: `annotateQuad()`

---

## Conceito Base

O LLM recebe uma imagem e retorna um JSON com bounding boxes de elementos de UI:

```json
{ "id": "btn_save", "type": "Button", "coordenadas": [x, y, w, h] }
```

O campo `coordenadas` pode estar em **dois sistemas de referência diferentes** dependendo de qual prompt foi usado:

| Sistema | O que significa | Exemplo numa imagem 1065×1080 |
|---------|----------------|-------------------------------|
| **pixels** | Coordenadas absolutas da imagem real | `[200, 150, 120, 40]` → botão em x=200px, y=150px |
| **normalized-1000** | Valores em [0, 1000] relativos a uma grade virtual | `[187, 138, 112, 37]` → ~18,7% do width, ~13,8% do height |

O `annotateQuad()` sempre recebe os mesmos valores do JSON e os interpreta de **4 formas diferentes**, salvando uma imagem para cada modo.

---

## Variáveis Usadas nas Fórmulas

```
json_x, json_y  → coordenadas de origem (top-left) vindas do JSON do LLM
json_w, json_h  → largura e altura da bounding box vindas do JSON
imgW            → largura real da imagem em pixels (ex.: 1065)
imgH            → altura real da imagem em pixels  (ex.: 1080)
px_*            → coordenada final em pixels absolutos para desenhar
```

---

## Modo A — `pixels_pure` (pixels puros)

### O que faz
Trata os valores do JSON diretamente como pixels absolutos da imagem real. Não faz nenhuma conversão — apenas garante que os valores não saem dos limites da imagem (clamp).

### Fórmula
```
px_x = clamp(round(json_x), 0, imgW)
px_y = clamp(round(json_y), 0, imgH)
px_w = clamp(round(json_w), 0, imgW - px_x)
px_h = clamp(round(json_h), 0, imgH - px_y)
```

### Exemplo
Imagem: `1065 × 1080`  
JSON retornado pelo LLM: `[200, 150, 120, 40]`

```
px_x = clamp(200, 0, 1065) = 200
px_y = clamp(150, 0, 1080) = 150
px_w = clamp(120, 0, 865)  = 120
px_h = clamp(40,  0, 930)  = 40
→ retângulo de 120×40 em (200, 150) — exatamente onde o botão está
```

### Prompt do LLM que usa esse modo
`v6pixels` / `v6PixelsEn` — instrução no system prompt:
```
Image resolution: EXACTLY {{IMAGE_WIDTH}} × {{IMAGE_HEIGHT}} pixels
Each bounding box: [x, y, width, height] in ABSOLUTE pixels.
0 ≤ x < {{IMAGE_WIDTH}}
0 ≤ y < {{IMAGE_HEIGHT}}
x + w ≤ {{IMAGE_WIDTH}}
y + h ≤ {{IMAGE_HEIGHT}}
```
O modelo recebe a resolução real injetada via `interpolatePrompt()` e é instruído a retornar coordenadas absolutas. O modo A é o caminho correto para esse prompt.

---

## Modo B — `pixels_via_norm` (pixels → 0-1000 → pixels)

### O que faz
Parte dos mesmos valores de pixels do modo A, os **normaliza para 0-1000** dividindo pelas dimensões da imagem, e depois **converte de volta** para pixels multiplicando. É um round-trip de verificação.

### Fórmula — Passo 1: pixels → 0-1000
```
norm_x = (json_x / imgW) × 1000
norm_y = (json_y / imgH) × 1000
norm_w = (json_w / imgW) × 1000
norm_h = (json_h / imgH) × 1000
```

### Fórmula — Passo 2: 0-1000 → pixels
```
px_x = (norm_x / 1000) × imgW   →  simplifica para json_x (identidade)
px_y = (norm_y / 1000) × imgH   →  simplifica para json_y
px_w = (norm_w / 1000) × imgW   →  simplifica para json_w
px_h = (norm_h / 1000) × imgH   →  simplifica para json_h
```

### Exemplo
Imagem: `1065 × 1080`  
JSON: `[200, 150, 120, 40]`

```
Passo 1 (→ 0-1000):
  norm_x = (200 / 1065) × 1000 = 187.79
  norm_y = (150 / 1080) × 1000 = 138.88
  norm_w = (120 / 1065) × 1000 = 112.67
  norm_h = (40  / 1080) × 1000 =  37.03

Passo 2 (→ pixels):
  px_x = (187.79 / 1000) × 1065 = 199.99 → round → 200
  px_y = (138.88 / 1000) × 1080 = 149.99 → round → 150
  px_w = (112.67 / 1000) × 1065 = 119.99 → round → 120
  px_h = (37.03  / 1000) × 1080 =  39.99 → round →  40
→ resultado idêntico ao modo A (pequena perda de precisão por ponto flutuante)
```

### Uso prático
Se A ≠ B visualmente, há acúmulo de erro de arredondamento no pipeline. É um teste de sanidade do sistema de conversão, não um modo para uso em produção.

---

## Modo C — `norm1000_correct` (normalized-1000 correto)

### O que faz
Trata os valores do JSON como já estando em escala 0-1000 e os converte para pixels reais multiplicando pelas dimensões da imagem. Este é o caminho correto quando o LLM foi treinado ou instruído a retornar coordenadas normalizadas.

### Fórmula
```
px_x = (json_x / 1000) × imgW
px_y = (json_y / 1000) × imgH
px_w = (json_w / 1000) × imgW
px_h = (json_h / 1000) × imgH
→ clamp nos limites da imagem
```

### Exemplo
Imagem: `1065 × 1080`  
JSON retornado pelo LLM: `[187, 138, 112, 37]` (valores já em 0-1000)

```
px_x = (187 / 1000) × 1065 = 199.15  → round → 199
px_y = (138 / 1000) × 1080 = 149.04  → round → 149
px_w = (112 / 1000) × 1065 = 119.28  → round → 119
px_h = (37  / 1000) × 1080 =  39.96  → round →  40
→ retângulo de ~119×40 em (~199, ~149) — correto
```

### Prompt do LLM que usa esse modo
`v8` / outros perfis que trabalham com grade virtual 0-1000:
```
Return bounding boxes normalized to a 1000×1000 virtual grid.
[x, y, w, h] where all values are in [0, 1000].
```
O modelo não precisa saber a resolução real — ele trabalha sempre em [0,1000] e o sistema converte. O modo C é o caminho correto para esse prompt.

---

## Modo D — `norm1000_raw` (pixels como 0-1000, modo bug)

### O que faz
O JSON contém pixels reais, mas o anotador os trata **como se fossem 0-1000** sem dividir primeiro. Isso aplica a conversão `× imgW/imgH` em cima de valores que já são pixels — resultando em caixas extremamente pequenas no canto superior esquerdo.

### Fórmula (o "bug")
```
-- O código deveria ser:
px_x = (json_x / 1000) × imgW  -- mas json_x já é pixel!

-- O que acontece na prática (com json_x = 200, imgW = 1065):
px_x = (200 / 1000) × 1065 = 213  ← não é o valor correto
       ↑ deveria ter dividido por imgW antes, não por 1000
```

### Exemplo
Imagem: `1065 × 1080`  
JSON com pixels: `[200, 150, 120, 40]` (pixels reais)

```
-- Modo D aplica a fórmula de normalized-1000 em valores que são pixels:
px_x = (200 / 1000) × 1065 = 213   ← próximo do valor original mas errado
px_y = (150 / 1000) × 1080 = 162
px_w = (120 / 1000) × 1065 = 127.8 → 128
px_h = (40  / 1000) × 1080 =  43.2 → 43

-- Contraste com Modo A (correto):
px_x = 200, px_y = 150, px_w = 120, px_h = 40
```

> **Nota:** Para imagens menores (ex.: `300 × 400`), o bug seria mais visível — caixas cairiam muito mais longe do elemento correto. Para resoluções próximas de 1000, o erro é sutil mas presente.

### Uso prático
Esse modo existe para **visualizar o estado anterior** do sistema, antes da introdução do `coordScale`. Era exatamente o que acontecia quando `defaultCoordScale = "normalized-1000"` estava ativo com o perfil `v6pixels`.

---

## Tabela Comparativa

| Modo | Entrada (JSON) | Fórmula | Resultado esperado | Prompt compatível |
|------|---------------|---------|-------------------|------------------|
| **A** `pixels_pure` | pixels reais | `json_x` → clamp | ✅ Correto | `v6pixels`, `v6PixelsEn` |
| **B** `pixels_via_norm` | pixels reais | `json_x ÷ imgW × 1000 ÷ 1000 × imgW` | ≈ A (round-trip) | verificação interna |
| **C** `norm1000_correct` | 0-1000 | `json_x ÷ 1000 × imgW` | ✅ Correto | `v8`, prompts 0-1000 |
| **D** `norm1000_raw` | pixels reais | `json_x ÷ 1000 × imgW` | ❌ Errado (bug) | nenhum — visualização de erro |

---

## Como o Prompt é Injetado

```
Frontend
  └─ POST /sessions/:id/steps { imageBase64, profiles: ["AnalisysComponentsLLM"], ... }
        │
        ▼
  GoogleService / OllamaService
    1. resolveImageDimensions(imageBase64)
       → lê header binário PNG/JPEG/WEBP → { width: 1065, height: 1080 }
    2. rawTemplate = Profiles["AnalisysComponentsLLM"]
       → "...resolution: {{IMAGE_WIDTH}} × {{IMAGE_HEIGHT}}..."
    3. interpolatePrompt(rawTemplate, { IMAGE_WIDTH: 1065, IMAGE_HEIGHT: 1080 })
       → "...resolution: EXACTLY 1065 × 1080 pixels..."
    4. Envia ao modelo com systemInstruction já resolvido
        │
        ▼
  LLM retorna JSON:
    { "coordenadas": [200, 150, 120, 40] }   ← valores em pixels 1065×1080
        │
        ▼
  annotateQuad({ analysis: { ui: full[] } })
    ├─ Modo A → desenha [200, 150, 120, 40] direto           → pixels/A_pixels_pure.png
    ├─ Modo B → round-trip via 0-1000                        → pixels/B_pixels_via_norm.png
    ├─ Modo C → trata como 0-1000 → converte                 → normalized/C_norm1000_correct.png
    └─ Modo D → aplica fórmula 0-1000 sem dividir (bug)      → normalized/D_norm1000_raw.png
```

---

## Quando A = C?

Se o LLM retornar exatamente os **mesmos valores** tanto no modo pixels quanto no modo 0-1000, as imagens seriam visualmente iguais **apenas se** `imgW = imgH = 1000`. Para qualquer outra resolução, eles divergem — o que torna a comparação visual entre A e C a ferramenta mais rápida para identificar qual escala o modelo usou.

---

*Documento gerado em 07/05/2026.*
