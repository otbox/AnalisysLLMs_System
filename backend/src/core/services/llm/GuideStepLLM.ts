import type { ProfileKey } from "./LLMsProfiles";
import type {
  ILLMService,
  LLMClient,
  StepModelInput,
  StepModelOutput,
} from "./ILLMService";

export class GuideStep implements ILLMService {
  public readonly profile: ProfileKey = "GuideLLM";
  public readonly model: string;
  private history: string[] = [];

  constructor(
    private readonly client: LLMClient,
    model?: string,
  ) {
    this.model = model ?? "nvidia/nemotron-nano-12b-v2-vl:free";
  }

  addToHistory(entry: string) {
    this.history.push(entry);
  }

  clearHistory() {
    this.history = [];
  }

  async callModel(params: StepModelInput): Promise<StepModelOutput> {
    const input: StepModelInput = {
      model: params.model,
      profile: this.profile,
      objective: params.objective,
      stepIndex: params.stepIndex,
      historySummary: params.historySummary,
      uiJson: params.uiJson,
      imageBase64: params.imageBase64,
      temperature: params.temperature,
    };

    const output = await this.client.callStep(input);

    this.addToHistory(
      `Passo ${params.stepIndex}: ação=${output.action}, confiança=${output.confidence}`,
    );

    return output;
  }
}
