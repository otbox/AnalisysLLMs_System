import { NvidiaObjectDetectionService } from "../services/llm/nvidia/NvidiaService";

type DetectRequestBody = {
  imageBase64: string;
  maxDetections?: number;
  confidenceThreshold?: number;
};

export class NvidiaDetectionController {
  constructor(
    private readonly detectionService: NvidiaObjectDetectionService,
  ) {}

  detectHandler = async (req: any, res: any) => {
    try {
      const { sessionId } = req.params as { sessionId: string };

      const {
        imageBase64,
        maxDetections,
        confidenceThreshold,
      } = req.body as DetectRequestBody;

      if (!imageBase64) {
        return res.status(400).send({ error: "imageBase64 is required" });
      }

      const output = await this.detectionService.detect({
        imageBase64,
        // maxDetections,
        // confidenceThreshold,
      });

      return res.send({
        sessionId,
        detections: output.detections,
        rawResponse: output.rawResponse,
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: err?.message ?? "Unknown error",
      });
    }
  };
}
