import type { Industry, Meta, Signal } from "./types";

export const BRAND_KEYS = ["celsius", "alani_nu", "monster", "red_bull", "ghost", "c4"] as const;
export const PERIODS = [4, 8, 12, 24, 52] as const;
export type BrandKey = (typeof BRAND_KEYS)[number];
export type Period = (typeof PERIODS)[number];

export interface BuyerBundle {
  columns: string[];
  rows: (string | number)[][];
  periods: number[];
  window: string[];
  min_cell: number;
}

export interface Switcher {
  id: string;
  region: string;
  state: string;
  tier: string;
  occasion: string;
  channel: string;
  reachable: boolean;
  consent: boolean;
  sourcePurchases: number;
  destinationPurchases: number;
  promoPurchases: number;
  lastWeek: number;
}

export interface RegionStat {
  region: string;
  sourceBase: number;
  switchers: number;
  rate: number;
}

export interface StateLean {
  state: string;
  region: string;
  categoryBuyers: number;
  sourceBuyers: number;
  destinationBuyers: number;
  sourceToDestination: number;
  destinationToSource: number;
  netSwitchers: number;
  leanPoints: number;
}

export interface PairSummary {
  period: Period;
  from: BrandKey;
  to: BrandKey;
  switchers: number;
  reachable: number;
  consented: number;
  reverse: number;
  net: number;
  switchRate: number;
  sourceBase: number;
  repeaters: number;
  promoLed: number;
  regions: Record<string, number>;
  regionStats: RegionStat[];
  channels: Record<string, number>;
  occasions: Record<string, number>;
  tiers: Record<string, number>;
  states: StateLean[];
  people: Switcher[];
}

export interface BrandWindow {
  brand: BrandKey;
  label: string;
  period: Period;
  buyers: number;
  categoryBuyers: number;
  observedShare: number;
  priorObservedShare: number | null;
  deltaPts: number | null;
  events: number;
  frequency: number;
  weeklyShare: number[];
}

export interface DashboardData {
  meta: Meta;
  industry: Industry;
  signals: Signal[];
  periods: Period[];
  pairs: Record<string, PairSummary>;
  brands: Record<string, BrandWindow>;
  definitions: Record<string, string>;
}

const SHORT: Record<BrandKey | "other", string> = {
  celsius: "celsius", alani_nu: "alani", monster: "monster", red_bull: "redbull",
  ghost: "ghost", c4: "c4", other: "other",
};
const LABEL: Record<BrandKey, string> = {
  celsius: "Celsius", alani_nu: "Alani Nu", monster: "Monster", red_bull: "Red Bull", ghost: "Ghost", c4: "C4",
};

function index(bundle: BuyerBundle) {
  return Object.fromEntries(bundle.columns.map((column, position) => [column, position]));
}

function purchaseColumn(brand: BrandKey | "other", period: Period, previous = false) {
  return `${SHORT[brand]}${previous ? "_prev" : ""}${period}`;
}

function active(row: (string | number)[], at: Record<string, number>, period: Period, previous = false) {
  return [...BRAND_KEYS, "other" as const].some((brand) => Number(row[at[purchaseColumn(brand, period, previous)]]) > 0);
}

function countBy(rows: Switcher[], key: "region" | "channel" | "occasion" | "tier") {
  return rows.reduce<Record<string, number>>((result, row) => {
    result[row[key]] = (result[row[key]] ?? 0) + 1;
    return result;
  }, {});
}

function isSwitch(row: (string | number)[], at: Record<string, number>, from: BrandKey, to: BrandKey, period: Period) {
  const source = Number(row[at[purchaseColumn(from, period)]]);
  const destination = Number(row[at[purchaseColumn(to, period)]]);
  return row[at.primary] === from && destination > source && destination > 0;
}

export function buildPairSummary(bundle: BuyerBundle, from: BrandKey, to: BrandKey, period: Period): PairSummary {
  const at = index(bundle);
  const sourceIndex = at[purchaseColumn(from, period)];
  const destinationIndex = at[purchaseColumn(to, period)];
  const activeRows = bundle.rows.filter((row) => active(row, at, period));
  const sourceBaseRows = activeRows.filter((row) => row[at.primary] === from);
  const switchedRows = activeRows.filter((row) => isSwitch(row, at, from, to, period));
  const people: Switcher[] = switchedRows.map((row) => ({
    id: String(row[at.id]), region: String(row[at.region]), state: String(row[at.state]), tier: String(row[at.tier]),
    occasion: String(row[at.occasion]), channel: String(row[at.channel]), reachable: row[at.reachable] === 1,
    consent: row[at.consent] === 1, sourcePurchases: Number(row[sourceIndex]), destinationPurchases: Number(row[destinationIndex]),
    promoPurchases: Number(row[at[`promo${period}`]]), lastWeek: Number(row[at.last_week]),
  }));
  const reverseRows = activeRows.filter((row) => isSwitch(row, at, to, from, period));
  const nationalSourcePenetration = activeRows.filter((row) => Number(row[sourceIndex]) > 0).length / Math.max(activeRows.length, 1);
  const nationalDestinationPenetration = activeRows.filter((row) => Number(row[destinationIndex]) > 0).length / Math.max(activeRows.length, 1);
  const regionNames = [...new Set(bundle.rows.map((row) => String(row[at.region])))];
  const regionStats = regionNames.map((region) => {
    const base = sourceBaseRows.filter((row) => row[at.region] === region).length;
    const count = people.filter((person) => person.region === region).length;
    return { region, sourceBase: base, switchers: count, rate: base ? count / base : 0 };
  });
  const stateNames = [...new Set(bundle.rows.map((row) => String(row[at.state])))];
  const states = stateNames.map<StateLean>((state) => {
    const rows = activeRows.filter((row) => row[at.state] === state);
    const sourceBuyers = rows.filter((row) => Number(row[sourceIndex]) > 0).length;
    const destinationBuyers = rows.filter((row) => Number(row[destinationIndex]) > 0).length;
    const forward = rows.filter((row) => isSwitch(row, at, from, to, period)).length;
    const reverse = rows.filter((row) => isSwitch(row, at, to, from, period)).length;
    const sourcePenetration = sourceBuyers / Math.max(rows.length, 1);
    const destinationPenetration = destinationBuyers / Math.max(rows.length, 1);
    return {
      state, region: rows.length ? String(rows[0][at.region]) : "", categoryBuyers: rows.length, sourceBuyers, destinationBuyers,
      sourceToDestination: forward, destinationToSource: reverse, netSwitchers: forward - reverse,
      leanPoints: rows.length ? ((destinationPenetration / Math.max(nationalDestinationPenetration, .0001)) - (sourcePenetration / Math.max(nationalSourcePenetration, .0001))) * 100 : 0,
    };
  });

  return {
    period, from, to, switchers: people.length, reachable: people.filter((person) => person.reachable).length,
    consented: people.filter((person) => person.consent).length, reverse: reverseRows.length,
    net: people.length - reverseRows.length, switchRate: sourceBaseRows.length ? people.length / sourceBaseRows.length : 0,
    sourceBase: sourceBaseRows.length, repeaters: people.filter((person) => person.destinationPurchases >= 2).length,
    promoLed: people.filter((person) => person.promoPurchases > 0).length, regions: countBy(people, "region"),
    regionStats, channels: countBy(people, "channel"), occasions: countBy(people, "occasion"), tiers: countBy(people, "tier"), states,
    people: people.filter((person) => person.reachable).slice(0, 60),
  };
}

export function buildBrandWindow(bundle: BuyerBundle, industry: Industry, brand: BrandKey, period: Period): BrandWindow {
  const at = index(bundle);
  const currentIndex = at[purchaseColumn(brand, period)];
  const currentRows = bundle.rows.filter((row) => active(row, at, period));
  const buyers = currentRows.filter((row) => Number(row[currentIndex]) > 0).length;
  const events = currentRows.reduce((sum, row) => sum + Number(row[currentIndex]), 0);
  let priorObservedShare: number | null = null;
  if (period < 52) {
    const priorIndex = at[purchaseColumn(brand, period, true)];
    const priorRows = bundle.rows.filter((row) => active(row, at, period, true));
    const priorBuyers = priorRows.filter((row) => Number(row[priorIndex]) > 0).length;
    priorObservedShare = priorRows.length ? priorBuyers / priorRows.length : 0;
  }
  const observedShare = currentRows.length ? buyers / currentRows.length : 0;
  const weeklyShare = industry.brands.find((row) => row.brand === brand)?.weekly_share ?? [];
  return {
    brand, label: LABEL[brand], period, buyers, categoryBuyers: currentRows.length, observedShare, priorObservedShare,
    deltaPts: priorObservedShare === null ? null : (observedShare - priorObservedShare) * 100,
    events, frequency: buyers ? events / buyers : 0, weeklyShare,
  };
}

export function buildDashboardData(meta: Meta, industry: Industry, signals: Signal[], buyers: BuyerBundle): DashboardData {
  const pairs: Record<string, PairSummary> = {};
  const brands: Record<string, BrandWindow> = {};
  for (const period of PERIODS) {
    for (const brand of BRAND_KEYS) brands[`${period}:${brand}`] = buildBrandWindow(buyers, industry, brand, period);
    for (const from of BRAND_KEYS) for (const to of BRAND_KEYS) if (from !== to) pairs[`${period}:${from}:${to}`] = buildPairSummary(buyers, from, to, period);
  }
  return {
    meta, industry, signals, periods: [...PERIODS], pairs, brands,
    definitions: {
      observedShare: "Distinct buyers purchasing the brand in the selected window / distinct category buyers in that window. Computed from all 25,000 buyer rows.",
      shareChange: "Selected-window observed buyer share minus the matched immediately preceding window. A 52-week change is unavailable because the panel has no preceding 52 weeks.",
      frequency: "Verified purchase events for the brand in the selected window / distinct buyers of that brand.",
      switchers: "Active buyers whose baseline primary brand is the source and whose destination purchases exceed source purchases in the selected window, with at least one destination purchase.",
      switchRate: "Verified switchers / active buyers whose baseline primary brand is the source.",
      netFlow: "Source-to-destination switchers minus destination-to-source switchers under the same selected-window rule.",
      reachable: "Switcher-qualified buyers currently marked reachable in the 25,000-row synthetic panel.",
      repeat: "Switcher-qualified buyers with at least two destination-brand purchases / all switcher-qualified buyers in the selected window.",
      stateLean: "Relative affinity index: each brand's state buyer penetration divided by its national penetration, then destination index minus source index. Positive values lean destination; negative values lean source.",
    },
  };
}
