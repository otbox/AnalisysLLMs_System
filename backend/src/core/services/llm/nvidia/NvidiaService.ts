// services/vision/NvidiaObjectDetectionService.ts
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_URL =
  "https://ai.api.nvidia.com/v1/cv/nvidia/nemoretriever-page-elements-v3";

if (!NVIDIA_API_KEY) {
  throw new Error("NVIDIA_API_KEY not defined");
}

export type NvidiaDetectionInput = {
  imageBase64: string; // pode vir COM ou SEM prefixo data:
};

export type NvidiaDetectionOutput = {
  detections: unknown; // depois você tipa melhor conforme a doc
  rawResponse: unknown;
};

export class NvidiaObjectDetectionService {
  async detect(
    input: NvidiaDetectionInput,
    signal?: AbortSignal,
  ): Promise<NvidiaDetectionOutput> {
    // garante data URL no formato que a API espera
    let url: string;
    if (input.imageBase64.startsWith("data:")) {
      url = input.imageBase64;
    } else {
      url = `data:image/png;base64,${input.imageBase64}`;
    }

    const payload = {
      input: [
        {
          type: "image_url",
          url,
        },
      ],
    };

    const res = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NVIDIA Object Detection error: ${res.status} ${text}`);
    }

    const data = (await res.json()) as any;

    // adapte aqui para o formato real de "detections" que esse modelo retorna
    return {
      detections: data, // ou data.output, etc.
      rawResponse: data,
    };
  }
}
