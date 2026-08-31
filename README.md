# Trends

Consumer research intelligence demo built around a synthetic panel of 25,000 buyers and 298,835 verified purchase events.

## Structure

- `web/`: Next.js dashboard, audited data science agent, map, forecasting, and WoE/IV diagnostics.
- `engine/`: deterministic synthetic-data generator, signal detection, statistical tests, and golden scenarios.

## Run

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000` or `http://localhost:3000/dashboard`.

## Sample questions

Use the dashboard question box with a source brand, destination brand, and time window selected. Good starter prompts:

- "Analyze brand switching drivers for energy drinks across Gen Z-style convenience occasions."
- "Why are Celsius buyers switching to Alani Nu, and which channels show the strongest movement?"
- "Where should we recruit reachable Monster-to-Ghost switchers for follow-up interviews?"

These questions are phrased like consumer research requests which the app uses to create a small analysis plan, runs approved statistical tools, and returns an evidence-backed answer.

## OpenAI planning

The application works without an API key using its deterministic local planner. To enable LLM planning and explanation:

```bash
cp web/.env.local.example web/.env.local
```

Set `OPENAI_API_KEY` in `web/.env.local`, then restart the server. The key is read only by the server route and must never use a `NEXT_PUBLIC_` prefix. OpenAI plans and explains analyses; approved statistical tools supply every numeric result.

## Architecture

```text
engine/ synthetic data generator
  -> web/data/*.json
  -> web/lib/dashboard.ts summary builders
  -> web/lib/agent.ts planner + approved analysis tools
  -> web/components/TrendsDashboard.tsx user-facing dashboard
```

- `engine/` builds the synthetic buyer panel, industry trend data, signals, tests, and golden scenarios.
- `web/data/` stores the generated JSON assets used by the Next.js app.
- `web/lib/dashboard.ts` turns raw buyer rows into brand windows, switcher cohorts, state affinity, repeat behavior, and pair summaries.
- `web/lib/feature-engineering.ts` calculates WoE/IV diagnostics for switcher-driver analysis.
- `web/lib/forecast.ts` creates the trend outlook used by forecast-style questions.
- `web/lib/agent.ts` accepts a natural-language question, creates or falls back to a local analysis plan, executes only approved operations, and checks that the final explanation is grounded in returned numeric results.
- `web/components/TrendsDashboard.tsx` renders the dashboard experience: brand controls, maps/charts, diagnostics, trace, and the research-style answer.

## WoE, IV, and interpretable diagnostics
The dashboard includes Weight of Evidence (WoE) and Information Value (IV) diagnostics to explain which observed buyer features are most associated with switching.

- **Target:** whether a source-brand buyer switched to the destination brand in the selected window.
- **Features:** region, tier, occasion, channel, and promotion exposure.
- **WoE:** compares a feature bin's share of switchers with its share of non-switchers. Positive WoE means the bin over-indexes among switchers; negative WoE means it under-indexes.
- **IV:** sums each bin's contribution into a feature-level score. Higher IV means the feature separates switchers from non-switchers more strongly.
- **Smoothing:** each bin uses small-count smoothing so rare bins do not create unstable or infinite WoE values.

This is useful because it keeps the analysis explainable. Instead of saying a model "found drivers," the app can show which categories have evidence, how strong the separation is, and whether the effect is negligible, weak, medium, or strong.

## Verification

```bash
cd web && npm run build && npm run typecheck
cd ../engine && python3 tests/test_golden.py
```
