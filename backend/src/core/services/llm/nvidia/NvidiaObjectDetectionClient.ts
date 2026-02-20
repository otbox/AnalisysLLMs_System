export type NvidiaDetectionInput = {
  imageBase64: string;        
  maxDetections?: number;     
  confidenceThreshold?: number; 
};

export type NvidiaBoundingBox = {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
};

export type NvidiaDetection = {
  class_name: string;
  score: number;
  box: NvidiaBoundingBox;
};

export type NvidiaDetectionOutput = {
  detections: NvidiaDetection[];
  rawResponse: unknown;
};
