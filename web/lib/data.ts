import fs from "node:fs";
import path from "node:path";
import type { Signal, Meta, Industry } from "./types";
import type { BuyerBundle } from "./dashboard";

const DATA = path.join(process.cwd(), "data");
function read<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")) as T;
}
export const getMeta = () => read<Meta>("meta.json");
export const getSignals = () => read<Signal[]>("signals.json");
export const getIndustry = () => read<Industry>("industry.json");
export const getBuyers = () => read<BuyerBundle>("buyers.json");
