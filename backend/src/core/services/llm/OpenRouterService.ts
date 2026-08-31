import { Message } from "openrouter-client/src/types";
import { OpenRouter } from "openrouter-client";
import {
  AnalisysPromptVersion,
  resolveProfilePrompt,
} from "./LLMsProfiles";
import {
  LLMClient,
  resolvePromptVersion,
  resolveTemperature,
  StepModelInput,
  StepModelOutput,
} from "./ILLMService";
import "dotenv/config";

const APIKEY = process.env.OPEN_ROUTER_API_KEY;

export class OpenRouterLLMClient implements LLMClient {
  private readonly client: OpenRouter;

  constructor() {
    if (!APIKEY) {
      throw new Error("OPEN_ROUTER_API_KEY not defined");
    }
    this.client = new OpenRouter(APIKEY);
  }

  async callStep(
    input: StepModelInput,
    signal?: AbortSignal,
  ): Promise<StepModelOutput> {
    console.log("Calling OpenRouter Service");
    const temperature = resolveTemperature(input.temperature);
    const promptVersion = resolvePromptVersion(input.profile, input.promptVersion);
    const messages = buildMessages(input, promptVersion);

    const result = await this.client.chat(
      messages,
      {
        model: input.model,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "usability_step_decision",
            schema: {
              type: "object",
              properties: {
                action: { type: "string" },
                rationale: { type: "string" },
                confidence: {
                  type: "number",
                  description:
                    "Confidence score between 0 and 100 (percentage)",
                },
              },
              required: ["action", "rationale", "confidence"],
            },
            strict: true,
          },
        },
        temperature,
        max_tokens: 20000,
      },
      signal,
    );

    if (!result.success) {
      throw new Error(
        "OpenRouter error: " +
          ("errorMessage" in result
            ? result.errorMessage
            : JSON.stringify(result)),
      );
    }

    const content = result.data.choices?.[0]?.message?.content ?? "{}";
    const parsed = safeParseJson(String(content));

    return {
      action: parsed.action ?? "",
      rationale: parsed.rationale ?? "",
      confidence: parsed.confidence ?? 0,
      rawResponse: result.data,
      temperature,
      promptVersion,
    };
  }
}

function buildMessages(
  input: StepModelInput,
  promptVersion?: AnalisysPromptVersion,
): Message[] {
  const userText = buildUserText(input);
  const content: any[] = [{ type: "text", text: userText }];

  if (input.imageBase64) {
    const url = input.imageBase64.startsWith("data:")
      ? input.imageBase64
      : `data:image/png;base64,${input.imageBase64}`;
    content.push({
      type: "image_url",
      image_url: { url },
    });
  }

  const systemPrompt = resolveProfilePrompt(input.profile, promptVersion);

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content },
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

  if (input.profile !== "AnalisysComponentsLLM") {
    parts.push(
      [
        "Responda APENAS em JSON com os campos:",
        " - action: string, próxima acção concreta do usuário;",
        " - rationale: string, explicação da escolha;",
        " - confidence: inteiro de 0 a 100, representando a confiança em %.",
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

function safeParseJson(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}
