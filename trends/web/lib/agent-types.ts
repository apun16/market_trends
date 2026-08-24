import type { BrandKey, Period } from "./dashboard";

export const ANALYSIS_TOOLS = [
  "brand_performance",
  "switching_flow",
  "segment_switching",
  "state_affinity",
  "promotion_durability",
  "market_context",
  "recruitment_cohort",
] as const;

export type AnalysisTool = (typeof ANALYSIS_TOOLS)[number];
export type AnalysisDimension = "region" | "state" | "channel" | "occasion" | null;
export type AnalysisOrder = "highest" | "lowest" | null;

export interface AnalysisOperation {
  id: string;
  tool: AnalysisTool;
  dimension: AnalysisDimension;
  order: AnalysisOrder;
  limit: number;
  purpose: string;
}

export interface AnalysisPlan {
  objective: string;
  rationale: string;
  operations: AnalysisOperation[];
}

export type ResultValue = string | number | boolean | null;

export interface AnalysisResult {
  operationId: string;
  tool: AnalysisTool;
  title: string;
  columns: string[];
  rows: Record<string, ResultValue>[];
  sampleSize: number;
  rowsScanned: number;
  calculation: string;
  caveat: string;
  durationMs: number;
}

export interface AnalysisTraceStep {
  id: string;
  kind: "plan" | "operation" | "synthesis";
  label: string;
  detail: string;
  status: "complete";
  durationMs: number;
  rowsScanned?: number;
}

export interface AnalysisRun {
  runId: string;
  question: string;
  context: {
    from: BrandKey;
    to: BrandKey;
    fromLabel: string;
    toLabel: string;
    period: Period;
    datasetRows: number;
    activeCategoryBuyers: number;
  };
  planner: { mode: "openai" | "local"; model: string | null };
  plan: AnalysisPlan;
  answer: { title: string; summary: string; findings: string[]; caveats: string[] };
  results: AnalysisResult[];
  trace: AnalysisTraceStep[];
  totalDurationMs: number;
}
