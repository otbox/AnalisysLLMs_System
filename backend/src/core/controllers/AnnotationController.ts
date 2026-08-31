// AnnotationController.ts

import { LlmImageAnnotatorService, AnnotateImageParams } from "../services/ImageAnnotationScale";

const annotator = new LlmImageAnnotatorService();


export class AnnotationController {
  createHandler = async (req: any, res: any) => {
    try {
      const {
        imageBase64,
        analysis,
        coordScale = "normalized-1000",
        sourceWidth,
        sourceHeight,
        llmBaseWidth,
        llmBaseHeight,
        offsetX,
        offsetY,
        includeLabel = true,
        stroke,
        fill,
        outputFormat,
      } = req.body as Partial<AnnotateImageParams & {
        llmBaseWidth?: number;
        llmBaseHeight?: number;
      }>;

      if (!imageBase64 || !analysis) {
        return res.status(400).json({
          message: "Campos obrigatórios: imageBase64 e analysis",
        });
      }

      const params: AnnotateImageParams = {
        imageBase64,
        analysis,
        coordScale,
        sourceWidth:  sourceWidth  ?? llmBaseWidth,
        sourceHeight: sourceHeight ?? llmBaseHeight,
        offsetX: Number(offsetX) || 0,
        offsetY: Number(offsetY) || 0,
        includeLabel,
        stroke,
        fill,
        outputFormat,
      };

      const dual = await annotator.annotateDual(params);

      return res.json({
        mimeType: dual.pixels.mimeType,
        width: dual.pixels.width,
        height: dual.pixels.height,
        elementsCount: dual.pixels.elementsCount,
        dataUri: dual.pixels.dataUri,
        pixels: {
          mimeType: dual.pixels.mimeType,
          width: dual.pixels.width,
          height: dual.pixels.height,
          elementsCount: dual.pixels.elementsCount,
          dataUri: dual.pixels.dataUri,
        },
        scaled: {
          mimeType: dual.scaled.mimeType,
          width: dual.scaled.width,
          height: dual.scaled.height,
          elementsCount: dual.scaled.elementsCount,
          dataUri: dual.scaled.dataUri,
        },
        adjustedUi: dual.adjustedUi,
        adjustedEstrutura: dual.adjustedEstrutura ?? null,
        adjustedJson: dual.adjustedEstrutura
          ? dual.adjustedEstrutura
          : { ui: dual.adjustedUi },
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
