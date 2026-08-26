export interface ForecastParameters {
  alpha: number;
  beta: number;
  phi: number;
}

export interface ForecastPoint {
  step: number;
  value: number;
  lower: number;
  upper: number;
}

export interface TrendForecast {
  horizon: number;
  observed: number[];
  points: ForecastPoint[];
  parameters: ForecastParameters;
  validationMae: number;
  residualSigma: number;
  trials: number;
  direction: "up" | "down" | "flat";
  delta: number;
}

interface Trial extends ForecastParameters { score: number }

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function fit(series: number[], parameters: ForecastParameters) {
  let level = series[0] ?? 0;
  let trend = (series[1] ?? level) - level;
  const residuals: number[] = [];
  for (let index = 1; index < series.length; index += 1) {
    const prediction = level + parameters.phi * trend;
    residuals.push(series[index] - prediction);
    const previousLevel = level;
    level = parameters.alpha * series[index] + (1 - parameters.alpha) * prediction;
    trend = parameters.beta * (level - previousLevel) + (1 - parameters.beta) * parameters.phi * trend;
  }
  return { level, trend, residuals };
}

function forecastValue(model: ReturnType<typeof fit>, parameters: ForecastParameters, step: number) {
  let damped = 0;
  for (let index = 1; index <= step; index += 1) damped += parameters.phi ** index;
  return model.level + damped * model.trend;
}

function validationMae(series: number[], parameters: ForecastParameters) {
  const start = Math.max(10, series.length - 16);
  const errors: number[] = [];
  for (let cutoff = start; cutoff < series.length; cutoff += 1) {
    const training = series.slice(0, cutoff);
    const predicted = forecastValue(fit(training, parameters), parameters, 1);
    errors.push(Math.abs(series[cutoff] - predicted));
  }
  return errors.reduce((sum, value) => sum + value, 0) / Math.max(errors.length, 1);
}

function candidate(index: number): ForecastParameters {
  const radicalInverse = (value: number, base: number) => {
    let result = 0;
    let factor = 1 / base;
    while (value > 0) {
      result += factor * (value % base);
      value = Math.floor(value / base);
      factor /= base;
    }
    return result;
  };
  return {
    alpha: .08 + .88 * radicalInverse(index + 1, 2),
    beta: .02 + .68 * radicalInverse(index + 1, 3),
    phi: .72 + .275 * radicalInverse(index + 1, 5),
  };
}

function distance(left: ForecastParameters, right: ForecastParameters) {
  return ((left.alpha - right.alpha) / .88) ** 2 + ((left.beta - right.beta) / .68) ** 2 + ((left.phi - right.phi) / .275) ** 2;
}

function surrogate(candidateValue: ForecastParameters, trials: Trial[]) {
  const weighted = trials.map((trial) => ({ trial, weight: Math.exp(-distance(candidateValue, trial) / .16) }));
  const total = weighted.reduce((sum, row) => sum + row.weight, 0) || 1;
  const mean = weighted.reduce((sum, row) => sum + row.weight * row.trial.score, 0) / total;
  const variance = weighted.reduce((sum, row) => sum + row.weight * (row.trial.score - mean) ** 2, 0) / total;
  const nearest = Math.min(...trials.map((trial) => distance(candidateValue, trial)));
  return { mean, uncertainty: Math.sqrt(variance + nearest * .00001) };
}

function optimize(series: number[], evaluations = 28) {
  const pool = Array.from({ length: 96 }, (_, index) => candidate(index));
  const trials: Trial[] = pool.slice(0, 8).map((parameters) => ({ ...parameters, score: validationMae(series, parameters) }));
  while (trials.length < evaluations) {
    const best = Math.min(...trials.map((trial) => trial.score));
    const evaluated = new Set(trials.map((trial) => `${trial.alpha}:${trial.beta}:${trial.phi}`));
    const next = pool.filter((row) => !evaluated.has(`${row.alpha}:${row.beta}:${row.phi}`)).map((row) => {
      const estimate = surrogate(row, trials);
      const acquisition = (best - estimate.mean) + 1.35 * estimate.uncertainty;
      return { row, acquisition };
    }).sort((left, right) => right.acquisition - left.acquisition)[0]?.row;
    if (!next) break;
    trials.push({ ...next, score: validationMae(series, next) });
  }
  return trials.sort((left, right) => left.score - right.score)[0];
}

export function buildTrendForecast(series: number[], horizon = 8): TrendForecast {
  if (series.length < 12) throw new Error("At least 12 observations are required for a trend forecast.");
  const selected = optimize(series);
  const parameters = { alpha: selected.alpha, beta: selected.beta, phi: selected.phi };
  const model = fit(series, parameters);
  const residualSigma = Math.sqrt(model.residuals.reduce((sum, value) => sum + value ** 2, 0) / Math.max(model.residuals.length - 2, 1));
  const points = Array.from({ length: horizon }, (_, index) => {
    const step = index + 1;
    const value = clamp(forecastValue(model, parameters, step), 0, 1);
    const interval = 1.645 * residualSigma * Math.sqrt(step);
    return { step, value, lower: clamp(value - interval, 0, 1), upper: clamp(value + interval, 0, 1) };
  });
  const delta = points.at(-1)!.value - series.at(-1)!;
  return {
    horizon, observed: series, points, parameters,
    validationMae: selected.score, residualSigma, trials: 28,
    direction: Math.abs(delta) < .0025 ? "flat" : delta > 0 ? "up" : "down",
    delta,
  };
}

export function nextWeeklyLabels(lastLabel: string, horizon: number) {
  const start = new Date(`${lastLabel}T00:00:00Z`);
  return Array.from({ length: horizon }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + (index + 1) * 7);
    return date.toISOString().slice(0, 10);
  });
}
