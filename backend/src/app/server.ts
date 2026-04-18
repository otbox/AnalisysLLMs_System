// app/server.ts
import Fastify from 'fastify';
import { buildContainer } from '../config/di-container';
import fastifyCors from "@fastify/cors";
import 'dotenv/config'
import { StepController } from '../core/controllers/LLMController';
import { AnalisisLLM } from '../core/services/llm/AnalisisLLM';
import { GoogleLLMClient } from '../core/services/llm/GoogleService';
import { GuideStep } from '../core/services/llm/GuideStepLLM';
import { OpenRouterLLMClient } from '../core/services/llm/OpenRouterService';
import { MODELOS_DISPONIVEIS } from '../core/services/llm/LLMModesAvaible';
import { NvidiaObjectDetectionService } from '../core/services/llm/nvidia/NvidiaService';
import { NvidiaDetectionController } from '../core/controllers/NvidiaController';
import { QueueService } from '../core/services/QueueService';
import { OllamaLLMClient } from '../core/services/llm/OllamaService';
import { AnnotateImageParams, AnalysisInput, UiElement, LlmImageAnnotatorService } from '../core/services/ImageAnnotationScale';

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

app.register(fastifyCors, {
  origin: true,
});

const { stepController } = buildContainer();

type LLMAPI = "OPENROUTER" | "GEMINI" | "OLLAMA"

const llmClientMap: Record<LLMAPI, any> = {
  OPENROUTER: new OpenRouterLLMClient(),
  GEMINI:     new GoogleLLMClient(),
  OLLAMA:     new OllamaLLMClient(),
};

/**
 * Normaliza o campo `analysis` que chega do frontend para o shape
 * que o LlmImageAnnotatorService espera (AnalysisInput com campo `ui`).
 *
 * Aceita:
 *   - array direto:              [{ coordenadas, ... }]
 *   - objeto com campo ui:       { ui: [...] }
 *   - objeto com campo elements: { elements: [...] }
 *   - objeto com campo components, full ou clean
 *   - objeto AnalysisInput já no formato correto (pass-through)
 */
function normalizeAnalysis(raw: unknown): AnalysisInput {
  if (Array.isArray(raw)) {
    return { ui: raw as UiElement[] };
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    // já tem ui preenchido — retorna como está
    if (Array.isArray(obj.ui) && (obj.ui as unknown[]).length > 0) {
      return obj as AnalysisInput;
    }

    // tenta campos alternativos e move para ui
    for (const key of ["elements", "components", "full", "clean"] as const) {
      if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0) {
        return { ...(obj as AnalysisInput), ui: obj[key] as UiElement[] };
      }
    }

    // pode ser um AnalysisInput com rawResponse mas sem ui ainda — pass-through
    return obj as AnalysisInput;
  }

  throw new Error("Campo 'analysis' inválido: esperado array ou objeto AnalysisInput.");
}

// ── rotas ─────────────────────────────────────────────────────────────────────

app.get('/openrouter/models', (req, res) => {
  res.send(MODELOS_DISPONIVEIS);
});

app.post('/sessions/:sessionId/steps', (req, res) => {
  const { LLMAPI } = req.body as { LLMAPI: LLMAPI };

  const llmClient       = llmClientMap[LLMAPI];
  const analysisService = new AnalisisLLM(llmClient);
  const guideService    = new GuideStep(llmClient);
  const cognitiveService = new AnalisisLLM(llmClient);
  const queueService    = new QueueService(analysisService, 1);
  const stepController  = new StepController({
    AnalisysComponentsLLM:   analysisService,
    GuideLLM:                guideService,
    CongnitiveWalktroughLLM: cognitiveService,
  }, queueService);

  return stepController.createHandler(req, res);
});

const annotator = new LlmImageAnnotatorService();

app.post('/annotations', async (req, res) => {
  try {
    const {
      imageBase64,
      analysis: rawAnalysis,
      coordScale    = "pixels",
      llmBaseWidth,
      llmBaseHeight,
      includeLabel  = true,
      stroke,
      fill,
      outputFormat,
    } = req.body as Partial<AnnotateImageParams & { analysis: unknown }>;

    if (!imageBase64 || !rawAnalysis) {
      return res.status(400).send({
        message: 'Campos obrigatórios: imageBase64 e analysis',
      });
    }

    const analysis = normalizeAnalysis(rawAnalysis);

    const result = await annotator.annotateFromAnalysis({
      imageBase64,
      analysis,
      coordScale,
      llmBaseWidth,
      llmBaseHeight,
      includeLabel,
      stroke,
      fill,
      outputFormat,
    });

    return res.send({
      mimeType:      result.mimeType,
      width:         result.width,
      height:        result.height,
      elementsCount: result.elementsCount,
      dataUri:       result.dataUri,
    });

  } catch (err: any) {
    req.log.error(err);
    return res.status(500).send({
      message: 'Erro ao gerar imagem anotada',
      error:   err?.message ?? 'Unknown error',
    });
  }
});

app.post('/analisysNvidia', (req, res) => {
  console.log("pong");
  const nvidiaAnalisysController = new NvidiaDetectionController(new NvidiaObjectDetectionService);
  return nvidiaAnalisysController.detectHandler(req, res);
});

const PORT = Number(process.env.PORT) || 3000;

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then((address) => {
    console.log(`🚀 Fastify rodando em ${address}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });