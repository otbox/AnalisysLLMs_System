import { Config, Message } from 'openrouter-client/src/types';
import { OpenRouter } from "openrouter-client";
import { ProfileKey, Profiles } from './LLMsProfiles';
import { LLMClient, StepModelInput, StepModelOutput } from './ILLMService';
import 'dotenv/config'

const APIKEY = process.env.OPEN_ROUTER_API_KEY;

if (!APIKEY) {
    throw new Error('OPEN_ROUTER_API_KEY not defined')
}


export class OpenRouterLLMClient implements LLMClient {
  private readonly client: OpenRouter;

  constructor() {
    this.client = new OpenRouter(APIKEY!);
  }

  async callStep(input: StepModelInput, signal?: AbortSignal): Promise<any> {
    const messages = buildMessages(input);

    const result = await this.client.chat(
      messages,
      {
        model: input.model,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'usability_step_decision',
            schema: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                rationale: { type: 'string' },
                confidence: {
                  type: 'number',
                  description: 'Confidence score between 0 and 100 (percentage)',
                },
              },
              required: ['action', 'rationale', 'confidence'],
            },
            strict: true,
          },
        },
        temperature: 0.2,
        max_tokens: 15000,
      },
      signal,
    );

    if (!result.success) {
      throw new Error(
        'OpenRouter error: ' +
          ('errorMessage' in result ? result.errorMessage : JSON.stringify(result)),
      );
    }

    const content = result.data.choices?.[0]?.message?.content ?? '{}';
    const parsed = safeParseJson(String(content));

    return {
      input,
      action: parsed.action ?? '',
      rationale: parsed.rationale ?? '',
      confidence: parsed.confidence ?? 0,
      rawResponse: result.data,
    };
  }
}

/** ==== Helpers de construção de mensagens ==== */

function buildMessages(input: StepModelInput): Message[] {
  const userText = buildUserText(input);

  const content: any[] = [{ type: 'text', text: userText }];

  if (input.imageBase64) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:image/png;base64,${input.imageBase64}`,
      },
    });
  }

  // aqui dá para escolher o profile dinamicamente
  const systemPrompt = Profiles[input.profile] ?? Profiles['AnalisysComponentsLLM'];

  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content,
    },
  ];
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

  if (input.profile !== 'AnalisysComponentsLLM') 
    {parts.push(
    [
      'Responda APENAS em JSON com os campos:',
      ' - action: string, próxima acção concreta do usuário;',
      ' - rationale: string, explicação da escolha;',
      ' - confidence: inteiro de 0 a 100, representando a confiança em %.'
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
