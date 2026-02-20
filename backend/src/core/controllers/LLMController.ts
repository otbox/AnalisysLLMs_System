import { ILLMService } from "../services/llm/ILLMService";
import { ProfileKey } from "../services/llm/LLMsProfiles";


type LLMServiceMap = Record<ProfileKey, ILLMService>;

type StepRequestBody = {
  models: string[];
  objective: string;
  stepIndex: number;
  imageBase64: string;
  uiJson?: string;
  historySummary?: string;
  profiles?: ProfileKey[]; // agora é array de profiles
};

export class StepController {
  constructor(
    private readonly services: LLMServiceMap,
  ) {}

  createHandler = async (req: any, res: any) => {
    const { sessionId } = req.params as { sessionId: string };

    const {
      objective,
      imageBase64,
      stepIndex,
      historySummary,
      profiles,
      uiJson,
      models,
    } = req.body as StepRequestBody;

    // console.log(req.body)

    const profilesToRun: ProfileKey[] =
      profiles && profiles.length > 0 ? profiles : ["AnalisysComponentsLLM"];

    const results = await Promise.all(
      profilesToRun.flatMap((profileKey) =>
        models.map(async (model) => {
            console.log("aquu",model)
          const service = this.services[profileKey];
          if (!service) {
            throw new Error(`LLMService not found for profile: ${profileKey}`);
          }
          
          const output = await service.callModel({
            objective,
            stepIndex,
            imageBase64,
            uiJson,
            historySummary,
            profile: profileKey,
            model,
          });

          return {
            profile: profileKey,
            model,
            ...output,
          };
        }),
      ),
    );

    return res.send({
      sessionId,
      stepIndex,
      objective,
      results,
    });
  };
}
