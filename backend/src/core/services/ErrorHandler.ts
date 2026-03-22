export type LLMErrorType = "quota_exceeded" | "rate_limit" | "auth" | "unknown";

export interface LLMError {
  type: LLMErrorType;
  message: string;
  retryable: boolean;
}

export function classifyLLMError(err: unknown): LLMError {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status ?? (err as any)?.code;

  if (status === 429 || msg.includes("429") || msg.toLowerCase().includes("rate")) {
    return { type: "rate_limit", message: "Limite de requisições atingido. Tente novamente em instantes.", retryable: true };
  }

  if (
    status === 403 ||
    msg.toLowerCase().includes("quota") ||
    msg.toLowerCase().includes("billing") ||
    msg.toLowerCase().includes("exceeded")
  ) {
    return { type: "quota_exceeded", message: "Cota gratuita da API esgotada.", retryable: false };
  }

  if (status === 401 || msg.toLowerCase().includes("api key")) {
    return { type: "auth", message: "Chave de API inválida ou ausente.", retryable: false };
  }

  return { type: "unknown", message: msg, retryable: false };
}