/* Shapes of the JSON the web app reads from data/. Only fields that are actually consumed are typed. */
export type State = "candidate" | "emerging" | "qualified" | "researching" | "explained" | "tracking" | "suppressed" | "dismissed" | "invalidated";
export interface Signal { id: string; title: string; state: State; kind: string; level: string; buyers: number }
export interface Meta {
  synthetic: boolean; seed: number; detector_version: string; generated_at: string;
  panel: { buyers: number; events: number; weeks: number; start: string; end: string; brands: string[]; regions: string[]; channels: string[] };
}
export interface Brand { brand: string; label: string; observed_share: number; weekly_share: number[] }
export interface Industry { brands: Brand[]; weeks: string[] }
