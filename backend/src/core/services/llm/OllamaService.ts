// OllamaService.ts
import { LLMClient, StepModelInput, StepModelOutput } from './ILLMService';
import { ProfileKey, Profiles } from './LLMsProfiles';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const RESPONSES_DIR = path.resolve('output', 'ollama_responses');

function saveResponses(params: {
  profile: string;
  model: string;
  stepIndex: number;
  rawContent: string;
  parsed: unknown;
}): void {
  try {
    const { profile, model, stepIndex, rawContent, parsed } = params;

    const safeModel = model.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(
      RESPONSES_DIR,
      `${profile}-${safeModel}`,
      `step${stepIndex}_${timestamp}`,
    );

    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, 'raw_response.json'),
      rawContent,
      'utf-8',
    );

    fs.writeFileSync(
      path.join(dir, 'parsed.json'),
      JSON.stringify(parsed, null, 2),
      'utf-8',
    );

    console.log(`[OllamaService] 💾 resposta salva em ${dir}`);
  } catch (err) {
    console.warn(
      '[OllamaService] saveResponses falhou:',
      (err as Error).message,
    );
  }
}

export class OllamaLLMClient implements LLMClient {
  constructor() {}

  async callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput> {
    console.log('Calling Ollama (streaming)');

    const systemPrompt =
      Profiles[input.profile] ?? Profiles['AnalisysComponentsLLM'];

    const userText = buildUserText(input);

    const body: any = {
      model: input.model ?? 'qwen3-vl', // ou o modelo de visão que você escolheu
      stream: true,                     // ✅ streaming ligado
      // format: 'json',                   // pede JSON no conteúdo final
      options: {
        num_gpu: 36,
        // num_ctx: 4096,/
        // num_predict: 10000,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    };

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama error: ${res.status} ${msg}`);
    }

    // ── ler stream linha a linha ─────────────────────────────────────────────
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalMessageContent = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) continue;

        // cada linha é um JSON com a forma:
        // { "message": { "content": "...parcial..." }, "done": false, ... }
        let chunk: any;
        try {
          chunk = JSON.parse(line);
        } catch {
          console.warn('[OllamaService] chunk inválido:', line);
          continue;
        }

        if (chunk.message?.content) {
          finalMessageContent += chunk.message.content;
        }

        if (chunk.done) {
          break;
        }
      }
    }

    const rawContent = finalMessageContent;
    const parsed = safeParseJson(rawContent);

    saveResponses({
      profile: input.profile,
      model: input.model ?? 'ollama-local',
      stepIndex: input.stepIndex,
      rawContent,
      parsed,
    });

    if (input.profile === 'AnalisysComponentsLLM' && input.imageBase64) {
      return {
        action: parsed.action ?? '',
        rationale: parsed.rationale ?? '',
        numberOfComponents: parsed.length ?? 0,
        confidence: parsed.confidence ?? 0,
        rawResponse: { message: { content: rawContent } },
      };
    }

    return {
      action: parsed.action ?? '',
      rationale: parsed.rationale ?? '',
      confidence: parsed.confidence ?? 0,
      rawResponse: { message: { content: rawContent } },
    };
  }
}

function buildUserText(input: StepModelInput): string {
  const parts: string[] = [];
  parts.push(`Objetivo do Usuário: ${input.objective}`);
  parts.push(`Passo atual do percurso: ${input.stepIndex}`);

  if (input.historySummary) {
    parts.push(`Resumo dos passos anteriores: ${input.historySummary}`);
  }

  if (input.uiJson) {
    parts.push(
      `Elementos da interface em JSON (use se ajudar, não precisa repetir tudo):\n${input.uiJson}`,
    );
  }

  if (input.profile !== 'AnalisysComponentsLLM') {
    parts.push(
      [
        'Responda APENAS em JSON com os campos:',
        ' - action: string, próxima acção concreta do usuário;',
        ' - rationale: string, explicação da escolha;',
        ' - confidence: inteiro de 0 a 100, representando a confiança em %.',
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}

function safeParseJson(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}