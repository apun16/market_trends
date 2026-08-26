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

## OpenAI planning

The application works without an API key using its deterministic local planner. To enable LLM planning and explanation:

```bash
cp web/.env.local.example web/.env.local
```

Set `OPENAI_API_KEY` in `web/.env.local`, then restart the server. The key is read only by the server route and must never use a `NEXT_PUBLIC_` prefix. OpenAI plans and explains analyses; approved statistical tools supply every numeric result.

## Verification

```bash
cd web && npm run build && npm run typecheck
cd ../engine && python3 tests/test_golden.py
```
