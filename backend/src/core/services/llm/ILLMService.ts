import { UiElement } from "../ImageAnnotation"
import { ProfileKey, Profiles } from "./LLMsProfiles"

export type StepModelInput = {
    model: string,
    profile: ProfileKey
    objective: string,
    stepIndex: number,
    historySummary?: string,
    uiJson?: string,
    imageBase64?: string
}

export type StepModelOutput = {
    action: string,
    rationale: string,
    numberOfComponents?: Number,
    imageOutputBase64?: string,
    confidence: number,
    rawResponse: unknown,
}

export interface CallModelResult {
    output: StepModelOutput;
    full: UiElement[];
    clean: UiElement[];
}

export interface LLMClient {
    callStep(input: StepModelInput, signal?: AbortSignal): Promise<StepModelOutput>;
}

export interface ILLMService {
    callModel(
        params: StepModelInput,
        idsToRemove?: string[]
    ): Promise<CallModelResult | StepModelOutput>;
}
