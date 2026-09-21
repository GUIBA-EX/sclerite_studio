export type Mode = "select" | "scale" | "cut" | "paint" | "erase";
export type Point = { x: number; y: number };
export type Parameters = {
  polarity: "dark" | "bright";
  backgroundRadius: number;
  threshold: number;
  automatic: boolean;
  minArea: number;
  fillHoles: boolean;
  excludeBorder: boolean;
  closingRadius: number;
  completeOnly: boolean;
  autoSplit: boolean;
  splitProminence: number;
  splitRadiusRatio: number;
};
export type Sclerite = {
  id: number;
  area: number;
  perimeter: number;
  length: number;
  width: number;
  aspect: number;
  circularity: number;
  cx: number;
  cy: number;
  bbox: [number, number, number, number];
  border: boolean;
  solidity: number;
};
export type Analysis = {
  classificationEpoch?: string;
  revision?: string;
  parameterKey?: string;
  labels: Int32Array;
  objects: Sclerite[];
  threshold: number;
  approvedIds?: number[];
  reviewHints?: Record<string, string>;
  splitEvents?: {
    parentId: number;
    childIds: number[];
    prominence: number;
    radiusRatio: number;
    seeds: { x: number; y: number; radius: number; prominence: number }[];
  }[];
  rejected?: {
    id: number;
    bbox: [number, number, number, number];
    reasons: string[];
  }[];
};
export type Calibration = {
  start: Point;
  end: Point;
  distanceUm: number;
  umPerPixel: number;
};
export type ImageEntry = {
  classification?: import("./classification").ClassificationData;
  study?: import("./species").StudyMetadata;
  sourceHash?: string;
  id: string;
  name: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  url: string;
  original: Blob;
  synthetic: boolean;
  analysis?: Analysis;
  calibration?: Calibration;
  params: Parameters;
  specimen: string;
  tissue: string;
  notes: Record<string, string>;
  undo: { analysis: Analysis; notes: Record<string, string> }[];
};
export const DEFAULTS: Parameters = {
  polarity: "dark",
  backgroundRadius: 0,
  threshold: 24,
  automatic: true,
  minArea: 1500,
  fillHoles: true,
  excludeBorder: true,
  closingRadius: 2,
  completeOnly: true,
  autoSplit: true,
  splitProminence: 0.3,
  splitRadiusRatio: 0.25,
};
export const COLORS = [
  "#00c5a0",
  "#e1a139",
  "#768cf6",
  "#eb7c99",
  "#52bcec",
  "#ce88e8",
];
