import type { ProfileKey } from "./LLMsProfiles";
import type {
  ILLMService,
  LLMClient,
  StepModelInput,
  StepModelOutput,
} from "./ILLMService";
import { ModelsAvaibleKey } from "./LLMModesAvaible";

export class AnalisisLLM implements ILLMService {
  public readonly profile: ProfileKey = "AnalisysComponentsLLM";
  public readonly model: ModelsAvaibleKey;
  private history: string[] = [];

  constructor(
    private readonly client: LLMClient,
    model?: ModelsAvaibleKey,
  ) {
    this.model = model ?? "google/gemma-3-12b-it:free";
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
      promptVersion: params.promptVersion,
    };
    const output = await this.client.callStep(input);

    this.addToHistory(
      `Passo ${params.stepIndex}: ação=${output.action}, confiança=${output.confidence}`,
    );

    return output;
  }
}
