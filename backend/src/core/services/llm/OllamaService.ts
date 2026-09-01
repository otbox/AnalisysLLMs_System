import { LLMClient, resolveTemperature, StepModelInput, StepModelOutput } from './ILLMService';
import { ProfileKey, Profiles, resolveAnalisysPrompt } from './LLMsProfiles';
import { resolveImageDimensions, interpolatePrompt } from './promptUtils';
import 'dotenv/config';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

interface OllamaMessage {
  role:    string;
  content: string;
  images?: string[];
}

interface OllamaRequest {
  model:    string;
  messages: OllamaMessage[];
  stream:   boolean;
  options?: Record<string, unknown>;
}

interface OllamaResponse {
  message: {
    role:    string;
    content: string;
  };
  done: boolean;
}

function safeParseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf('[');
    const end   = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
    }
    const os = cleaned.indexOf('{');
    const oe = cleaned.lastIndexOf('}');
    if (os >= 0 && oe > os) {
      try { return JSON.parse(cleaned.slice(os, oe + 1)); } catch {}
    }
    return {};
  }
}

export class OllamaLLMClient implements LLMClient {
  async callStep(input: StepModelInput): Promise<StepModelOutput> {
    console.log(`[OllamaService] Calling Ollama model: ${input.model}`);

    const temperature = resolveTemperature(input.temperature);

    // ── Inject real image dimensions into the prompt template ──────────────
    const rawTemplate =
      input.profile === 'AnalisysComponentsLLM' && input.promptVersion
        ? resolveAnalisysPrompt(input.promptVersion)
        : Profiles[input.profile as ProfileKey] ?? Profiles['AnalisysComponentsLLM'];
    const dims         = input.imageBase64
      ? resolveImageDimensions(input.imageBase64)
      : { width: 0, height: 0 };
    const systemPrompt = interpolatePrompt(rawTemplate, {
      IMAGE_WIDTH:  dims.width,
      IMAGE_HEIGHT: dims.height,
    });

    console.log(
      `[OllamaService] Image dimensions: ${dims.width}×${dims.height} ` +
      `| Profile: ${input.profile}`,
    );

    const userMessage = buildUserMessage(input);

    const body: OllamaRequest = {
      model:   input.model,
      stream:  false,
      options: { temperature },
      messages: [
        { role: 'system', content: systemPrompt },
        userMessage,
      ],
    };

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${text}`);
    }

    const json = await res.json() as OllamaResponse;
    const content = json?.message?.content ?? '';
    const parsed  = safeParseJson(content) as any;

    console.log(`[OllamaService] Response length: ${content.length} chars`);

    return {
      action:      parsed?.action     ?? '',
      rationale:   parsed?.rationale  ?? '',
      confidence:  parsed?.confidence ?? 0,
      rawResponse: { candidates: [{ content: { parts: [{ text: content }] } }] },
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildUserMessage(input: StepModelInput): OllamaMessage {
  const textParts: string[] = [];
  textParts.push(`User objective: ${input.objective}`);
  textParts.push(`Current step: ${input.stepIndex}`);

  if (input.historySummary) {
    textParts.push(`Summary of previous steps: ${input.historySummary}`);
  }
  if (input.uiJson) {
    textParts.push(
      `Interface elements as JSON (use if helpful):\n${input.uiJson}`,
    );
  }
  if (input.profile !== 'AnalisysComponentsLLM') {
    textParts.push(
      [
        'Respond ONLY in JSON with the fields:',
        ' - action: string, next concrete user action;',
        ' - rationale: string, reasoning for the choice;',
        ' - confidence: integer 0-100.',
      ].join('\n'),
    );
  }

  const message: OllamaMessage = { role: 'user', content: textParts.join('\n\n') };

  if (input.imageBase64) {
    const pure = input.imageBase64.startsWith('data:')
      ? input.imageBase64.split(',')[1] ?? ''
      : input.imageBase64;
    message.images = [pure];
  }

  return message;
}
