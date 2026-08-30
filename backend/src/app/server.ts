// app/server.ts
import Fastify                             from 'fastify';
import fastifyCors                         from '@fastify/cors';
import 'dotenv/config';

import { StepController }                  from '../core/controllers/LLMController';
import { AnalisisLLM }                     from '../core/services/llm/AnalisisLLM';
import { GoogleLLMClient }                 from '../core/services/llm/GoogleService';
import { GuideStep }                       from '../core/services/llm/GuideStepLLM';
import { OpenRouterLLMClient }             from '../core/services/llm/OpenRouterService';
import { MODELOS_DISPONIVEIS }             from '../core/services/llm/LLMModesAvaible';
import { NvidiaObjectDetectionService }    from '../core/services/llm/nvidia/NvidiaService';
import { NvidiaDetectionController }       from '../core/controllers/NvidiaController';
import { QueueService }                    from '../core/services/QueueService';
import { OllamaLLMClient }                 from '../core/services/llm/OllamaService';
import {
  AnnotateImageParams,
  AnalysisInput,
  CoordScale,
  UiElement,
  LlmImageAnnotatorService,
} from '../core/services/ImageAnnotationScale';

// ─────────────────────────────────────────────────────────────────────────────
// Global coord-scale configuration
// Change this ONE value to switch how the whole system interprets LLM coords.
// Can also be overridden per-request via the `coordScale` field in the body.
// ─────────────────────────────────────────────────────────────────────────────
export const GLOBAL_COORD_SCALE: CoordScale = "pixels";

// ─────────────────────────────────────────────────────────────────────────────

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

app.register(fastifyCors, { origin: true });

type LLMAPI = "OPENROUTER" | "GEMINI" | "OLLAMA";

const llmClientMap: Record<LLMAPI, any> = {
  OPENROUTER: new OpenRouterLLMClient(),
  GEMINI:     new GoogleLLMClient(),
  OLLAMA:     new OllamaLLMClient(),
};

/**
 * Normalise the `analysis` field coming from the frontend into a shape
 * that LlmImageAnnotatorService expects (AnalysisInput with `ui` field).
 */
function normalizeAnalysis(raw: unknown): AnalysisInput {
  if (Array.isArray(raw)) return { ui: raw as UiElement[] };

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (Array.isArray(obj.ui) && (obj.ui as unknown[]).length > 0)
      return obj as AnalysisInput;

    for (const key of ["elements", "components", "full", "clean"] as const) {
      if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0)
        return { ...(obj as AnalysisInput), ui: obj[key] as UiElement[] };
    }

    return obj as AnalysisInput;
  }

  throw new Error("Invalid 'analysis' field: expected array or AnalysisInput object.");
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/openrouter/models', (_req, res) => {
  res.send(MODELOS_DISPONIVEIS);
});

app.post('/sessions/:sessionId/steps', (req, res) => {
  const { LLMAPI } = req.body as { LLMAPI: LLMAPI };

  const llmClient        = llmClientMap[LLMAPI];
  const analysisService  = new AnalisisLLM(llmClient);
  const guideService     = new GuideStep(llmClient);
  const cognitiveService = new AnalisisLLM(llmClient);
  const queueService     = new QueueService(analysisService, 1);

  const controller = new StepController(
    {
      AnalisysComponentsLLM:   analysisService,
      GuideLLM:                guideService,
      CongnitiveWalktroughLLM: cognitiveService,
    },
    queueService,
    undefined,             // outputDir — keep default
    GLOBAL_COORD_SCALE,    // ← single config point
  );

  return controller.createHandler(req, res);
});

const annotator = new LlmImageAnnotatorService();

app.post('/annotations', async (req, res) => {
  try {
    const {
      imageBase64,
      analysis: rawAnalysis,
      // honour explicit coordScale from caller; fall back to global default
      coordScale   = GLOBAL_COORD_SCALE,
      includeLabel = false,
      stroke,
      fill,
      outputFormat,
      sourceWidth,
      sourceHeight,
      llmBaseWidth,
      llmBaseHeight,
      offsetX,
      offsetY,
    } = req.body as Partial<AnnotateImageParams & {
      analysis: unknown;
      llmBaseWidth?: number;
      llmBaseHeight?: number;
    }>;

    if (!imageBase64 || !rawAnalysis) {
      return res.status(400).send({ message: 'Required fields: imageBase64 and analysis' });
    }

    const analysis = normalizeAnalysis(rawAnalysis);

    // Always produce both images; return both URLs to the caller.
    const dual = await annotator.annotateDual({
      imageBase64,
      analysis,
      coordScale,
      includeLabel,
      stroke,
      fill,
      outputFormat,
      sourceWidth:  sourceWidth  ?? llmBaseWidth,
      sourceHeight: sourceHeight ?? llmBaseHeight,
      offsetX: Number(offsetX) || 0,
      offsetY: Number(offsetY) || 0,
    });

    return res.send({
      // pixels variant (original resolution)
      pixels: {
        mimeType:      dual.pixels.mimeType,
        width:         dual.pixels.width,
        height:        dual.pixels.height,
        elementsCount: dual.pixels.elementsCount,
        dataUri:       dual.pixels.dataUri,
      },
      // scaled variant (display-safe viewport)
      scaled: {
        mimeType:      dual.scaled.mimeType,
        width:         dual.scaled.width,
        height:        dual.scaled.height,
        elementsCount: dual.scaled.elementsCount,
        dataUri:       dual.scaled.dataUri,
      },
      // JSON com coordenadas finais (remap + offset). Preserva todos os elementos.
      adjustedUi: dual.adjustedUi,
      adjustedEstrutura: dual.adjustedEstrutura ?? null,
      adjustedJson: dual.adjustedEstrutura
        ? dual.adjustedEstrutura
        : { ui: dual.adjustedUi },
      // backward-compat alias → points to pixels
      dataUri: dual.pixels.dataUri,
    });

  } catch (err: any) {
    req.log.error(err);
    return res.status(500).send({
      message: 'Error generating annotated image',
      error:   err?.message ?? 'Unknown error',
    });
  }
});

app.post('/analisysNvidia', (req, res) => {
  const nvidiaController = new NvidiaDetectionController(new NvidiaObjectDetectionService());
  return nvidiaController.detectHandler(req, res);
});

const PORT = Number(process.env.PORT) || 3000;

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then((address) => console.log(`🚀 Fastify running at ${address}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
