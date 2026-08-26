import type { BrandKey, BuyerBundle, Period } from "./dashboard";

export interface WoeBin {
  feature: string;
  bin: string;
  switchers: number;
  nonSwitchers: number;
  woe: number;
  ivContribution: number;
}

export interface FeatureIv {
  feature: string;
  iv: number;
  strength: "negligible" | "weak" | "medium" | "strong";
  bins: WoeBin[];
}

const SHORT: Record<BrandKey, string> = {
  celsius: "celsius", alani_nu: "alani", monster: "monster", red_bull: "redbull", ghost: "ghost", c4: "c4",
};

const strength = (iv: number): FeatureIv["strength"] => iv < .02 ? "negligible" : iv < .1 ? "weak" : iv < .3 ? "medium" : "strong";

export function calculateWoeIv(bundle: BuyerBundle, from: BrandKey, to: BrandKey, period: Period) {
  const at = Object.fromEntries(bundle.columns.map((column, position) => [column, position]));
  const sourceColumn = at[`${SHORT[from]}${period}`];
  const destinationColumn = at[`${SHORT[to]}${period}`];
  const sourceRows = bundle.rows.filter((row) => row[at.primary] === from && Number(row[sourceColumn]) + Number(row[destinationColumn]) > 0);
  const records = sourceRows.map((row) => ({
    target: Number(row[destinationColumn]) > Number(row[sourceColumn]) && Number(row[destinationColumn]) > 0,
    values: {
      region: String(row[at.region]),
      tier: String(row[at.tier]),
      occasion: String(row[at.occasion]),
      channel: String(row[at.channel]),
      promotion_exposure: Number(row[at[`promo${period}`]]) > 0 ? "exposed" : "not_exposed",
    },
  }));
  const totalSwitchers = records.filter((row) => row.target).length;
  const totalNonSwitchers = records.length - totalSwitchers;
  const features = Object.keys(records[0]?.values ?? {}) as (keyof (typeof records)[number]["values"])[];
  const output = features.map<FeatureIv>((feature) => {
    const values = [...new Set(records.map((row) => row.values[feature]))].sort();
    const bins = values.map<WoeBin>((bin) => {
      const switchers = records.filter((row) => row.target && row.values[feature] === bin).length;
      const nonSwitchers = records.filter((row) => !row.target && row.values[feature] === bin).length;
      const switchDistribution = (switchers + .5) / (totalSwitchers + .5 * values.length);
      const nonSwitchDistribution = (nonSwitchers + .5) / (totalNonSwitchers + .5 * values.length);
      const woe = Math.log(switchDistribution / nonSwitchDistribution);
      return { feature, bin, switchers, nonSwitchers, woe, ivContribution: (switchDistribution - nonSwitchDistribution) * woe };
    });
    const iv = bins.reduce((sum, row) => sum + row.ivContribution, 0);
    return { feature, iv, strength: strength(iv), bins };
  }).sort((left, right) => right.iv - left.iv);
  return { sampleSize: records.length, switchers: totalSwitchers, nonSwitchers: totalNonSwitchers, features: output };
}
