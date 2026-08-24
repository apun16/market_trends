import "server-only";

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ANALYSIS_TOOLS, type AnalysisOperation, type AnalysisPlan, type AnalysisResult, type AnalysisRun, type AnalysisTool, type ResultValue } from "./agent-types";
import { BRAND_KEYS, PERIODS, buildBrandWindow, buildPairSummary, type BrandKey, type BrandWindow, type BuyerBundle, type PairSummary, type Period } from "./dashboard";
import { getBuyers, getIndustry } from "./data";
import type { Industry } from "./types";

const MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";
const LABELS: Record<BrandKey, string> = {
  celsius: "Celsius", alani_nu: "Alani Nu", monster: "Monster", red_bull: "Red Bull", ghost: "Ghost", c4: "C4",
};

interface AnalysisContext {
  bundle: BuyerBundle;
  industry: Industry;
  from: BrandKey;
  to: BrandKey;
  period: Period;
  pair: PairSummary;
  source: BrandWindow;
  destination: BrandWindow;
}

export async function runAnalysis(input: { question: string; from: string; to: string; period: number }): Promise<AnalysisRun> {
  const started = performance.now();
  const question = input.question.trim().slice(0, 600);
  const from = parseBrand(input.from);
  const to = parseBrand(input.to);
  const period = parsePeriod(input.period);
  if (!question) throw new Error("A question is required.");
  if (from === to) throw new Error("Choose two different brands.");

  const bundle = getBuyers();
  const industry = getIndustry();
  const context: AnalysisContext = {
    bundle, industry, from, to, period,
    pair: buildPairSummary(bundle, from, to, period),
    source: buildBrandWindow(bundle, industry, from, period),
    destination: buildBrandWindow(bundle, industry, to, period),
  };

  const planStarted = performance.now();
  const planned = await createPlan(question, context);
  const planDuration = elapsed(planStarted);
  const results: AnalysisResult[] = [];
  const operationTrace: AnalysisRun["trace"] = [];

  for (const operation of planned.plan.operations) {
    const operationStarted = performance.now();
    const result = executeOperation(operation, context);
    result.durationMs = elapsed(operationStarted);
    results.push(result);
    operationTrace.push({
      id: operation.id,
      kind: "operation",
      label: result.title,
      detail: `${operation.tool} returned ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}; n=${result.sampleSize.toLocaleString()}.`,
      status: "complete",
      durationMs: result.durationMs,
      rowsScanned: result.rowsScanned,
    });
  }

  const synthesisStarted = performance.now();
  const synthesized = await synthesize(question, context, planned.plan, results);
  const synthesisDuration = elapsed(synthesisStarted);
  const answer = numbersAreGrounded(synthesized, results, context) ? synthesized : localSynthesis(question, context, results);

  return {
    runId: `run_${randomUUID().slice(0, 8)}`,
    question,
    context: {
      from, to, fromLabel: LABELS[from], toLabel: LABELS[to], period,
      datasetRows: bundle.rows.length, activeCategoryBuyers: context.destination.categoryBuyers,
    },
    planner: planned.planner,
    plan: planned.plan,
    answer,
    results,
    trace: [
      { id: "plan", kind: "plan", label: "Structured analysis plan", detail: `${planned.plan.operations.length} approved operation${planned.plan.operations.length === 1 ? "" : "s"} selected.`, status: "complete", durationMs: planDuration },
      ...operationTrace,
      { id: "synthesis", kind: "synthesis", label: "Evidence-constrained synthesis", detail: "Narrative checked against executed numeric outputs.", status: "complete", durationMs: synthesisDuration },
    ],
    totalDurationMs: elapsed(started),
  };
}

function parseBrand(value: string): BrandKey {
  if ((BRAND_KEYS as readonly string[]).includes(value)) return value as BrandKey;
  throw new Error("Unsupported brand selection.");
}

function parsePeriod(value: number): Period {
  if ((PERIODS as readonly number[]).includes(value)) return value as Period;
  throw new Error("Unsupported analysis period.");
}

async function createPlan(question: string, context: AnalysisContext) {
  if (!process.env.OPENAI_API_KEY) return { plan: localPlan(question), planner: { mode: "local" as const, model: null } };
  try {
    const raw = await callOpenAI({
      name: "analysis_plan",
      schema: planSchema,
      instructions: "You are a data science planner. Select only approved operations. Never answer the question and never invent data. Keep the plan minimal and sufficient.",
      input: JSON.stringify({ question, selectedBrands: [LABELS[context.from], LABELS[context.to]], periodWeeks: context.period, approvedTools: ANALYSIS_TOOLS }),
    });
    return { plan: sanitizePlan(raw, question), planner: { mode: "openai" as const, model: MODEL } };
  } catch {
    return { plan: localPlan(question), planner: { mode: "local" as const, model: null } };
  }
}

function localPlan(question: string): AnalysisPlan {
  const q = question.toLowerCase();
  const operations: AnalysisOperation[] = [];
  const add = (tool: AnalysisTool, purpose: string, dimension: AnalysisOperation["dimension"] = null, order: AnalysisOperation["order"] = null, limit = 8) => {
    if (!operations.some((operation) => operation.tool === tool && operation.dimension === dimension)) operations.push({ id: `op_${operations.length + 1}`, tool, dimension, order, limit, purpose });
  };

  if (/slow|lowest|lag/.test(q)) add("segment_switching", "Locate the lowest normalized switching rate.", q.includes("state") ? "state" : "region", "lowest", 8);
  if (/fast|highest|where.*gain|region/.test(q) && !/slow|lowest|lag/.test(q)) add("segment_switching", "Locate the highest normalized switching rate.", "region", "highest", 8);
  if (/state|geograph|map|lean/.test(q)) add("state_affinity", "Compare relative brand affinity and switch flow by state.", "state", /source|baseline/.test(q) ? "lowest" : "highest", 10);
  if (/promo|durab|repeat|trial|retention/.test(q)) add("promotion_durability", "Separate promotion exposure from observed repeat behavior.");
  if (/interview|recruit|audience|talk to|contact/.test(q)) {
    add("recruitment_cohort", "Size the reachable and consented research cohort.");
    add("segment_switching", "Find a useful geographic recruiting quota.", "region", "highest", 5);
  }
  if (/market|industry|category|beyond|overall/.test(q)) {
    add("market_context", "Place the brand comparison inside category-level movement.");
    add("brand_performance", "Compare brand penetration, frequency, and change.");
  }
  if (/why|driv|explain|mechanism/.test(q)) {
    add("switching_flow", "Establish the verified behavioral movement.");
    add("segment_switching", "Locate where the movement concentrates.", "channel", "highest", 6);
    add("promotion_durability", "Test promotion exposure and early repeat as observable mechanisms.");
  }
  if (!operations.length) {
    add("switching_flow", "Measure directional buyer movement and net flow.");
    add("brand_performance", "Compare current brand performance with the prior window.");
  }
  return {
    objective: question,
    rationale: "Use the smallest set of approved descriptive operations that can answer the question from verified buyer behavior.",
    operations: operations.slice(0, 4),
  };
}

function sanitizePlan(value: unknown, question: string): AnalysisPlan {
  if (!value || typeof value !== "object") return localPlan(question);
  const candidate = value as { objective?: unknown; rationale?: unknown; operations?: unknown };
  if (!Array.isArray(candidate.operations)) return localPlan(question);
  const operations = candidate.operations.slice(0, 4).flatMap((item, index): AnalysisOperation[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!ANALYSIS_TOOLS.includes(row.tool as AnalysisTool)) return [];
    const dimensions = ["region", "state", "channel", "occasion", null];
    const orders = ["highest", "lowest", null];
    return [{
      id: `op_${index + 1}`,
      tool: row.tool as AnalysisTool,
      dimension: dimensions.includes(row.dimension as never) ? row.dimension as AnalysisOperation["dimension"] : null,
      order: orders.includes(row.order as never) ? row.order as AnalysisOperation["order"] : null,
      limit: Math.min(12, Math.max(1, Number(row.limit) || 8)),
      purpose: typeof row.purpose === "string" ? row.purpose.slice(0, 180) : "Answer the selected question.",
    }];
  });
  if (!operations.length) return localPlan(question);
  return {
    objective: typeof candidate.objective === "string" ? candidate.objective.slice(0, 240) : question,
    rationale: typeof candidate.rationale === "string" ? candidate.rationale.slice(0, 400) : "Approved operations selected for the question.",
    operations,
  };
}

function executeOperation(operation: AnalysisOperation, context: AnalysisContext): AnalysisResult {
  const base = { operationId: operation.id, tool: operation.tool, durationMs: 0, rowsScanned: context.bundle.rows.length };
  const { pair, source, destination } = context;
  if (operation.tool === "brand_performance") return {
    ...base, title: "Brand performance", columns: ["brand", "buyers", "buyer_share", "change_pts", "purchase_events", "frequency"],
    rows: [source, destination].map((brand) => ({ brand: brand.label, buyers: brand.buyers, buyer_share: percent(brand.observedShare), change_pts: brand.deltaPts === null ? "n/a" : signed(brand.deltaPts), purchase_events: brand.events, frequency: `${brand.frequency.toFixed(2)}x` })),
    sampleSize: destination.categoryBuyers,
    calculation: "Distinct brand buyers / active category buyers. Frequency = verified purchase events / distinct brand buyers. Change compares the selected window with its immediately preceding matched window.",
    caveat: context.period === 52 ? "No matched prior 52-week window exists, so change is unavailable." : "Buyer share is panel penetration, not dollar or unit market share.",
  };
  if (operation.tool === "switching_flow") return {
    ...base, title: "Directional switching flow", columns: ["direction", "switchers", "source_base", "switch_rate", "reachable"],
    rows: [
      { direction: `${LABELS[context.from]} to ${LABELS[context.to]}`, switchers: pair.switchers, source_base: pair.sourceBase, switch_rate: percent(pair.switchRate), reachable: pair.reachable },
      { direction: `${LABELS[context.to]} to ${LABELS[context.from]}`, switchers: pair.reverse, source_base: destination.buyers, switch_rate: "see caveat", reachable: "not requested" },
      { direction: "Net toward destination", switchers: signed(pair.net), source_base: "n/a", switch_rate: "n/a", reachable: "n/a" },
    ], sampleSize: pair.sourceBase,
    calculation: "A switcher is category-active, has the source as baseline primary brand, and records more destination than source purchases with at least one destination purchase. Net = forward - reverse.",
    caveat: "The reverse row reports the symmetric switch count; its displayed source base is destination-brand buyers, not the stricter baseline-primary denominator used by the forward rate.",
  };
  if (operation.tool === "segment_switching") return segmentResult(operation, context);
  if (operation.tool === "state_affinity") {
    const rows = [...pair.states].sort((a, b) => operation.order === "lowest" ? a.leanPoints - b.leanPoints : b.leanPoints - a.leanPoints).slice(0, operation.limit).map((state) => ({
      state: state.state, region: titleCase(state.region), active_buyers: state.categoryBuyers, source_buyers: state.sourceBuyers,
      destination_buyers: state.destinationBuyers, destination_lean_pts: signed(state.leanPoints), net_switchers: signed(state.netSwitchers),
    }));
    return { ...base, title: "State brand affinity", columns: ["state", "region", "active_buyers", "source_buyers", "destination_buyers", "destination_lean_pts", "net_switchers"], rows, sampleSize: destination.categoryBuyers,
      calculation: "For each state, brand buyer penetration is indexed to that brand's national penetration. Destination index minus source index is reported in points; positive values lean destination.",
      caveat: "Affinity is relative panel penetration, not sales share. State estimates are descriptive and synthetic." };
  }
  if (operation.tool === "promotion_durability") return {
    ...base, title: "Promotion and repeat durability", columns: ["measure", "buyers", "share_of_switchers"],
    rows: [
      { measure: "Promotion-exposed switchers", buyers: pair.promoLed, share_of_switchers: percent(pair.promoLed / Math.max(pair.switchers, 1)) },
      { measure: `Repeated ${LABELS[context.to]} 2+ times`, buyers: pair.repeaters, share_of_switchers: percent(pair.repeaters / Math.max(pair.switchers, 1)) },
      { measure: "One-time destination buyers", buyers: pair.switchers - pair.repeaters, share_of_switchers: percent((pair.switchers - pair.repeaters) / Math.max(pair.switchers, 1)) },
    ], sampleSize: pair.switchers,
    calculation: "Promotion incidence and destination repeat incidence are computed within the same qualified switcher cohort for the selected window.",
    caveat: "Promotion exposure can occur anywhere in the window and does not prove that promotion caused the switch.",
  };
  if (operation.tool === "market_context") {
    const brandRows = BRAND_KEYS.map((brand) => buildBrandWindow(context.bundle, context.industry, brand, context.period)).sort((a, b) => b.observedShare - a.observedShare);
    return { ...base, title: "Category brand context", columns: ["brand", "buyers", "buyer_share", "change_pts", "frequency"],
      rows: brandRows.map((brand) => ({ brand: brand.label, buyers: brand.buyers, buyer_share: percent(brand.observedShare), change_pts: brand.deltaPts === null ? "n/a" : signed(brand.deltaPts), frequency: `${brand.frequency.toFixed(2)}x` })),
      sampleSize: destination.categoryBuyers, calculation: "Ranks every tracked brand on observed buyer penetration in the same selected panel window and compares it with the matched prior window.",
      caveat: "Cross-brand penetration is non-exclusive: one buyer may purchase multiple brands." };
  }
  return {
    ...base, title: "Recruitable switcher cohort", columns: ["cohort", "buyers", "share_of_switchers"],
    rows: [
      { cohort: "Qualified switchers", buyers: pair.switchers, share_of_switchers: "100.0%" },
      { cohort: "Reachable now", buyers: pair.reachable, share_of_switchers: percent(pair.reachable / Math.max(pair.switchers, 1)) },
      { cohort: "Badge consented", buyers: pair.consented, share_of_switchers: percent(pair.consented / Math.max(pair.switchers, 1)) },
      { cohort: "Reachable repeaters", buyers: pair.people.filter((person) => person.destinationPurchases >= 2).length, share_of_switchers: percent(pair.people.filter((person) => person.destinationPurchases >= 2).length / Math.max(pair.switchers, 1)) },
    ], sampleSize: pair.switchers,
    calculation: "Intersects the qualified switcher cohort with current reachability, evidence-badge consent, and observed destination repeat behavior.",
    caveat: "The reachable repeater count is limited to the reachable roster exposed by the demo and should be treated as a recruitment floor.",
  };
}

function segmentResult(operation: AnalysisOperation, context: AnalysisContext): AnalysisResult {
  const { pair } = context;
  if (operation.dimension === "state") {
    const rows = [...pair.states].map((state) => ({ segment: state.state, switchers: state.sourceToDestination, source_base: state.sourceBuyers, switch_rate: state.sourceBuyers ? state.sourceToDestination / state.sourceBuyers : 0 }))
      .filter((row) => row.source_base >= context.bundle.min_cell).sort((a, b) => operation.order === "lowest" ? a.switch_rate - b.switch_rate : b.switch_rate - a.switch_rate).slice(0, operation.limit);
    return segmentTable("state", rows, operation, context);
  }
  if (operation.dimension === "channel" || operation.dimension === "occasion") {
    const dimension = operation.dimension;
    const counts = dimension === "channel" ? pair.channels : pair.occasions;
    const rows = Object.entries(counts).map(([segment, switchers]) => ({ segment: titleCase(segment), switchers, cohort_share: switchers / Math.max(pair.switchers, 1) }))
      .sort((a, b) => operation.order === "lowest" ? a.switchers - b.switchers : b.switchers - a.switchers).slice(0, operation.limit);
    return {
      operationId: operation.id, tool: operation.tool, title: `Switcher concentration by ${dimension}`, columns: [dimension, "switchers", "cohort_share"],
      rows: rows.map((row) => ({ [dimension]: row.segment, switchers: row.switchers, cohort_share: percent(row.cohort_share) })), sampleSize: pair.switchers, rowsScanned: context.bundle.rows.length,
      calculation: `Qualified switchers grouped by their assigned ${dimension}; cohort share = segment switchers / all qualified switchers.`,
      caveat: `This is cohort composition, not a normalized ${dimension} switch rate, because a category-active baseline denominator is not defined for this field.`, durationMs: 0,
    };
  }
  const rows = pair.regionStats.filter((row) => row.sourceBase >= context.bundle.min_cell).map((row) => ({ segment: titleCase(row.region), switchers: row.switchers, source_base: row.sourceBase, switch_rate: row.rate }))
    .sort((a, b) => operation.order === "lowest" ? a.switch_rate - b.switch_rate : b.switch_rate - a.switch_rate).slice(0, operation.limit);
  return segmentTable("region", rows, operation, context);
}

function segmentTable(dimension: "region" | "state", rows: { segment: string; switchers: number; source_base: number; switch_rate: number }[], operation: AnalysisOperation, context: AnalysisContext): AnalysisResult {
  return {
    operationId: operation.id, tool: operation.tool, title: `Normalized switching by ${dimension}`, columns: [dimension, "switchers", "source_base", "switch_rate"],
    rows: rows.map((row) => ({ [dimension]: row.segment, switchers: row.switchers, source_base: row.source_base, switch_rate: percent(row.switch_rate) })),
    sampleSize: rows.reduce((sum, row) => sum + row.source_base, 0), rowsScanned: context.bundle.rows.length,
    calculation: `For each ${dimension}: qualified source-to-destination switchers / active buyers whose baseline primary brand is the source.`,
    caveat: `${titleCase(dimension)}s with fewer than ${context.bundle.min_cell} active baseline source buyers are suppressed. Lowest or highest describes an observed rate, not a causal forecast.`, durationMs: 0,
  };
}

async function synthesize(question: string, context: AnalysisContext, plan: AnalysisPlan, results: AnalysisResult[]) {
  if (!process.env.OPENAI_API_KEY) return localSynthesis(question, context, results);
  try {
    const raw = await callOpenAI({
      name: "analysis_explanation",
      schema: answerSchema,
      instructions: "Explain executed statistical outputs. Every number must be copied exactly from the supplied results. Do not calculate, estimate, add, infer, or invent any numeric value. Separate observed association from causal explanation.",
      input: JSON.stringify({ question, context: { from: LABELS[context.from], to: LABELS[context.to], period: context.period }, plan, results }),
    });
    const candidate = raw as AnalysisRun["answer"];
    if (candidate && typeof candidate.title === "string" && Array.isArray(candidate.findings) && Array.isArray(candidate.caveats)) return candidate;
  } catch { /* deterministic synthesis remains available */ }
  return localSynthesis(question, context, results);
}

function localSynthesis(question: string, context: AnalysisContext, results: AnalysisResult[]): AnalysisRun["answer"] {
  const first = results[0];
  const firstRow = first?.rows[0] ?? {};
  const q = question.toLowerCase();
  if (first?.tool === "segment_switching") {
    const segment = String(firstRow.region ?? firstRow.state ?? "The leading segment");
    const rate = String(firstRow.switch_rate ?? "n/a");
    const direction = /slow|lowest|lag/.test(q) ? "slowest" : "fastest";
    return { title: `${segment} is the ${direction} observed switching market.`, summary: `${firstRow.switchers} of ${firstRow.source_base} active baseline ${LABELS[context.from]} buyers switched toward ${LABELS[context.to]}, a ${rate} rate in the selected ${context.period}-week window.`, findings: [`The ranked ${first.columns[0]} result is ${segment}.`, `The calculation uses ${firstRow.source_base} baseline source buyers as its denominator.`, `${first.rows.length} eligible segments were returned after minimum-cell suppression.`], caveats: [first.caveat] };
  }
  if (first?.tool === "state_affinity") return { title: `${firstRow.state} shows the strongest displayed destination affinity.`, summary: `${firstRow.state} records ${firstRow.destination_lean_pts} relative affinity points toward ${LABELS[context.to]} and ${firstRow.net_switchers} net switchers in the selected window.`, findings: [`Active state sample: ${firstRow.active_buyers} buyers.`, `Destination buyers: ${firstRow.destination_buyers}.`, `Source buyers: ${firstRow.source_buyers}.`], caveats: [first.caveat] };
  const promo = results.find((result) => result.tool === "promotion_durability");
  if (promo) return { title: "The switch has an observed repeat signal, with promotion exposure still present.", summary: `${promo.rows[0].buyers} switchers were promotion-exposed, while ${promo.rows[1].buyers} purchased ${LABELS[context.to]} at least twice.`, findings: promo.rows.map((row) => `${row.measure}: ${row.buyers} buyers (${row.share_of_switchers}).`), caveats: [promo.caveat] };
  const market = results.find((result) => result.tool === "market_context");
  if (market) return { title: "The selected brand movement sits inside a broader category pattern.", summary: `The category comparison ranks ${market.rows.length} tracked brands across ${market.sampleSize.toLocaleString()} active category buyers in the selected ${context.period}-week window.`, findings: market.rows.slice(0, 3).map((row) => `${row.brand}: ${row.buyer_share} buyer share, ${row.change_pts} points versus prior.`), caveats: [market.caveat] };
  const flow = results.find((result) => result.tool === "switching_flow");
  if (flow) return { title: `${LABELS[context.to]} has the stronger observed directional flow in this comparison.`, summary: `${context.pair.switchers} baseline ${LABELS[context.from]} buyers switched toward ${LABELS[context.to]}; reverse flow is ${context.pair.reverse}, producing a net of ${signed(context.pair.net)}.`, findings: [`Forward switch rate: ${percent(context.pair.switchRate)} from ${context.pair.sourceBase} baseline source buyers.`, `${context.pair.reachable} qualified switchers are currently reachable.`, `${context.pair.repeaters} qualified switchers repeated the destination brand.`], caveats: [flow.caveat] };
  const brand = results.find((result) => result.tool === "brand_performance") ?? first;
  return { title: "The selected comparison has been computed from the buyer panel.", summary: `${brand?.sampleSize.toLocaleString() ?? context.destination.categoryBuyers.toLocaleString()} active category buyers were analyzed across the selected ${context.period}-week window.`, findings: (brand?.rows ?? []).slice(0, 3).map((row) => `${row.brand ?? row.measure}: ${row.buyer_share ?? row.share_of_switchers ?? row.buyers}.`), caveats: brand ? [brand.caveat] : ["No approved operation returned a result."] };
}

function numbersAreGrounded(answer: AnalysisRun["answer"], results: AnalysisResult[], context: AnalysisContext) {
  const allowed = new Set((JSON.stringify({ results, period: context.period, rows: context.bundle.rows.length }).match(/-?\d+(?:\.\d+)?/g) ?? []).map(normalizeNumber));
  return (JSON.stringify(answer).match(/-?\d+(?:\.\d+)?/g) ?? []).every((value) => allowed.has(normalizeNumber(value)));
}

async function callOpenAI({ name, schema, instructions, input }: { name: string; schema: Record<string, unknown>; instructions: string; input: string }): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, instructions, input, text: { format: { type: "json_schema", name, strict: true, schema } } }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Planner request failed: ${response.status}`);
  const body = await response.json() as { output_text?: string; output?: { content?: { type?: string; text?: string }[] }[] };
  const text = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("Planner returned no structured output.");
  return JSON.parse(text);
}

const operationProperties = {
  tool: { type: "string", enum: [...ANALYSIS_TOOLS] },
  dimension: { type: ["string", "null"], enum: ["region", "state", "channel", "occasion", null] },
  order: { type: ["string", "null"], enum: ["highest", "lowest", null] },
  limit: { type: "integer", minimum: 1, maximum: 12 },
  purpose: { type: "string" },
};
const planSchema = { type: "object", additionalProperties: false, required: ["objective", "rationale", "operations"], properties: { objective: { type: "string" }, rationale: { type: "string" }, operations: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: Object.keys(operationProperties), properties: operationProperties } } } };
const answerSchema = { type: "object", additionalProperties: false, required: ["title", "summary", "findings", "caveats"], properties: { title: { type: "string" }, summary: { type: "string" }, findings: { type: "array", items: { type: "string" } }, caveats: { type: "array", items: { type: "string" } } } };

function elapsed(start: number) { return Math.max(1, Math.round(performance.now() - start)); }
function percent(value: number) { return `${(value * 100).toFixed(1)}%`; }
function signed(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(Number.isInteger(value) ? 0 : 2)}`; }
function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function normalizeNumber(value: string) { return String(Number(value)); }
export function resultValue(value: unknown): ResultValue { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value); }
