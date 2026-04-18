// AnnotationController.ts

import { LlmImageAnnotatorService, AnnotateImageParams } from "../services/ImageAnnotationScale";

const annotator = new LlmImageAnnotatorService();


export class AnnotationController {
  createHandler = async (req: any, res: any) => {
    try {
      const {
        imageBase64,
        analysis,
        coordScale = "pixels",
        llmBaseWidth,
        llmBaseHeight,
        includeLabel = true,
        stroke,
        fill,
        outputFormat,
      } = req.body as Partial<AnnotateImageParams>;

      if (!imageBase64 || !analysis) {
        return res.status(400).json({
          message: "Campos obrigatórios: imageBase64 e analysis",
        });
      }

      const params: AnnotateImageParams = {
        imageBase64,
        analysis,
        coordScale,
        llmBaseWidth,
        llmBaseHeight,
        includeLabel,
        stroke,
        fill,
        outputFormat,
      };

      const result = await annotator.annotateFromAnalysis(params);

      // retorna base64 pronto para <img src="...">
      return res.json({
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
        elementsCount: result.elementsCount,
        dataUri: result.dataUri,
      });
    } catch (err: any) {
      console.error("[AnnotationController] erro:", err?.message ?? err);
      return res.status(500).json({
        message: "Erro ao gerar imagem anotada",
        error: err?.message ?? "Unknown error",
      });
    }
  };
}