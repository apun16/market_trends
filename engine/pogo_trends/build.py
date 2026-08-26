from __future__ import annotations
import json, pathlib, time
from .synth import generate, BRAND_LABEL, TODAY, START, N_BUYERS, COVERAGE_GAP, REGIONS, CHANNELS
from .aggregate import Panel
from .detect import build_signals, THRESH, week_label
from .industry import industry, buyer_summaries
from .research import cohort, study_guide, fieldwork, claims, clips
from . import SEED, DETECTOR_VERSION

OUT = pathlib.Path(__file__).resolve().parents[2] / "web" / "data"
GOLDEN = pathlib.Path(__file__).resolve().parents[1] / "golden.json"


def run(out_dir: pathlib.Path = OUT) -> dict:
    t0 = time.time()
    buyers, events = generate()
    p = Panel(buyers, events)
    signals, cov, ll = build_signals(p)
    sw = next(s for s in signals if s["id"] == "sig_switch_celsius_alani")
    coh = cohort(p, sw); guide = study_guide(sw, coh); fw = fieldwork(p, sw, coh, guide)
    cl = claims(fw, sw); cp = clips(fw, cl)
    ind = industry(p)
    bs = buyer_summaries(p)

    rank = {"qualified": 0, "emerging": 1, "tracking": 2, "candidate": 3, "suppressed": 4}
    for s in signals:
        s["detected_at"] = s.get("detected_week") or s["momentum"]["window"]["start"]
        s["reachable"] = s["profile"]["reachable"] if "profile" in s else None
    signals.sort(key=lambda s: (rank[s["state"]], -(abs((s["momentum"]["ratio"] or 1) - 1))))
    # strip heavy fields from the feed, keep in detail
    FEED_FIELDS = ("id", "title", "state", "kind", "level", "buyers")
    feed = [{k: s[k] for k in FEED_FIELDS} for s in signals]
    meta = {
        "synthetic": True, "dataset_version": "2.0.0", "seed": SEED,
        "detector_version": DETECTOR_VERSION, "generated_at": TODAY.isoformat(),
        "methodology": "Buyer-level longitudinal choice simulation with stable latent preferences, regional availability, channel effects, prices, promotions, and market diffusion.",
        "panel": {"buyers": N_BUYERS, "events": len(events), "weeks": 52, "start": START.isoformat(), "end": TODAY.isoformat(),
                  "brands": list(BRAND_LABEL.values()), "regions": list(REGIONS), "channels": list(CHANNELS)},
        "thresholds": THRESH, "coverage_gap_planted": {"merchant": COVERAGE_GAP["merchant"], "weeks": [week_label(w) for w in COVERAGE_GAP["weeks"]], "retained": COVERAGE_GAP["retained"]},
        "quality": ind["quality"],
        "build_seconds": round(time.time() - t0, 1),
    }
    golden = {
        "switch_velocity": round(sw["switching"]["velocity"], 2), "switchers": sw["switching"]["current"]["switchers"],
        "eligible": sw["switching"]["current"]["eligible"], "reachable": sw["profile"]["reachable"],
        "observed_lead_days": ll["observed_lead_days"], "household_credible_at": ll["household_credible_at"],
        "attention_credible_at": ll["attention_credible_at"], "flagged_merchants": cov["flagged_merchants"],
        "states": {s["id"]: s["state"] for s in signals}, "events": len(events),
        "promo_trial_claim": [cl[0]["k"], cl[0]["n"]], "taste_claim": [cl[1]["k"], cl[1]["n"]], "workout_claim": [cl[2]["k"], cl[2]["n"]],
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    files = {"meta.json": meta, "signals.json": feed, "industry.json": ind, "buyers.json": bs}
    for name, obj in files.items():
        (out_dir / name).write_text(json.dumps(obj, separators=(",", ":")))
    GOLDEN.write_text(json.dumps(golden, indent=1))
    return golden


if __name__ == "__main__":
    g = run()
    print(json.dumps(g, indent=1))
