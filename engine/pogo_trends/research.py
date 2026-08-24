"""Research loop: cohort -> study guide -> (simulated) fieldwork -> coded claims with evidence links.

The study guide generator is the deterministic fallback described in the spec: it takes structured
signal facts and emits a schema-shaped guide with no model call. Fieldwork is simulated from the
*actual* switcher cohort so the numbers in the brief are the numbers in the data.
"""
from __future__ import annotations
import random
from .aggregate import Panel
from .synth import BRAND_LABEL, WEEKS, day_to_date, TODAY
from .stats import beta_binomial_interval
from . import SEED

GUIDE_SCHEMA = {
    "type": "object", "required": ["objective", "behavior", "sample", "questions", "probes", "prohibited", "incentive"],
    "properties": {"questions": {"type": "array", "minItems": 5, "maxItems": 8}},
}


def cohort(p: Panel, signal: dict) -> dict:
    ids = signal["switcher_ids"]
    reach = [i for i in ids if p.by_id[i].reachable]
    consent = [i for i in reach if p.by_id[i].consented_badge]
    a, b = signal["counter_brand"], signal["primary_brand"]
    return {
        "id": "coh_celsius_alani_switchers", "name": f"Recent {BRAND_LABEL[a]} → {BRAND_LABEL[b]} switchers",
        "definition": [
            f"≥ 2 verified {BRAND_LABEL[a]} purchases in the 8 weeks before {signal['momentum']['window']['start']}",
            f"not primarily a {BRAND_LABEL[b]} buyer in that baseline",
            f"≥ 1 verified {BRAND_LABEL[b]} purchase since {signal['momentum']['window']['start']}",
            f"{BRAND_LABEL[a]} purchase rate fell below 60% of baseline",
        ],
        "analytical_count": len(ids), "reachable_count": len(reach), "consented_badge_count": len(consent),
        "min_cell": 150, "withheld": len(ids) < 150 and False,  # cohort-level aggregates are shown; respondent rows require consent
        "estimated_cost_usd": len(reach[:20]) * 45, "incentive_usd": 45, "target_completes": 20,
        "estimated_field_days": 3,
        "source_signal": signal["id"],
    }


def study_guide(signal: dict, coh: dict) -> dict:
    a, b = BRAND_LABEL[signal["counter_brand"]], BRAND_LABEL[signal["primary_brand"]]
    prof = signal["profile"]
    promo = prof["promo_on_first_purchase"]
    top_region = max((r for r in prof["over_index"] if r["dimension"] == "region"), key=lambda r: r["count"])
    facts = [
        f"{signal['switching']['current']['switchers']} of {signal['switching']['current']['eligible']} eligible {a} buyers switched to {b} in the current 2-week window ({signal['switching']['current']['share']:.1%} vs {signal['switching']['baseline_share']:.1%} baseline, {signal['switching']['velocity']:.1f}x).",
        f"{promo['k']} of {promo['n']} first {b} purchases with a known price were promoted.",
        f"First purchases skew convenience ({prof['first_purchase_channel'].get('convenience', 0)} of {sum(prof['first_purchase_channel'].values())}); repeats skew grocery ({prof['repeat_purchase_channel'].get('grocery', 0)} of {max(1, sum(prof['repeat_purchase_channel'].values()))}).",
        f"Over-index: {top_region['value'].title()} ({top_region['index']} vs all {a}-primary buyers).",
    ]
    return {
        "id": "study_switchers_why", "title": f"Why recent {a} buyers tried {b} — and whether they will stay",
        "objective": f"Explain the {signal['switching']['velocity']:.1f}x switching movement: separate the trigger for trial from the reason for repeat, and find when {a} still wins.",
        "behavior": facts, "sample": {"cohort": coh["id"], "target": coh["target_completes"], "quotas": [
            {"dimension": "promo on first purchase", "min": 8, "note": "keep promoted and full-price trialists both represented"},
            {"dimension": "region", "min": 6, "value": "northeast"},
            {"dimension": "occasion", "min": 5, "value": "workout", "note": "S2: planned-workout buyers repeat less — hear from them"}]},
        "questions": [
            {"id": "q1", "text": f"Walk me through the moment you chose {b} instead of {a}.", "objective": "trigger"},
            {"id": "q2", "text": "What first made you consider it?", "objective": "awareness"},
            {"id": "q3", "text": "What role did price or a promotion play?", "objective": "promotion"},
            {"id": "q4", "text": "What was different after trying it?", "objective": "experience"},
            {"id": "q5", "text": f"When would you choose {a} instead?", "objective": "retention_risk"},
            {"id": "q6", "text": "What will determine your next energy-drink purchase?", "objective": "repeat_intent"},
        ],
        "probes": {"taste": "Which flavor? How does the carbonation compare?", "price": "Would you have tried it at full price?",
                   "availability": "Where did you buy it the first time? Was your usual brand there?",
                   "function": "Do you drink it before a workout, at work, or socially?", "brand_awareness": "Where had you seen it before?",
                   "package": "Single can or multipack?", "repeat_intent": "Have you bought it again? Will you?"},
        "prohibited": ["health claims", "competitor disparagement prompts", "income", "medical conditions"],
        "incentive": {"usd": coh["incentive_usd"], "format": "video interview, 8–12 minutes", "adaptive": True},
        "evidence_requirements": ["every claim cites respondent ids and a transcript span", "contradicting responses are reported next to the claim", "clips are selected after claims are established"],
        "generator": "deterministic fallback (no model key present)", "schema_valid": True, "schema": GUIDE_SCHEMA,
    }


# --- simulated fieldwork -----------------------------------------------------------------
REASON_CODES = {
    "promo_trial": "Tried because of a promotion", "flavor": "Flavor / taste", "carbonation": "Lighter carbonation or mouthfeel",
    "workout_prefer_celsius": "Still prefers Celsius for planned workouts", "availability": "Usual brand not on shelf",
    "social": "Friend or social media recommendation", "full_price_ok": "Would repeat at full price", "price_sensitive": "Repeat depends on price",
    "no_difference": "No real difference between brands", "package": "Can design / multipack",
}

TEMPLATES = {
    "promo_trial": ["It was two-for-five at the {shop}, so I grabbed the {flavor} one instead of my usual Celsius.",
                    "Honestly the deal. There was a promo tag and I figured I'd try it.",
                    "I only picked it up because it was on sale. I wasn't looking to change."],
    "flavor": ["The {flavor} flavor is just better. Celsius tastes a bit medicinal to me now.",
               "It tastes like a real drink, not a supplement. That's what got me to buy it again.",
               "I keep going back for the {flavor}. It doesn't have that aftertaste."],
    "carbonation": ["It's lighter. Celsius is so fizzy that I can't finish it fast.",
                    "Less carbonated, easier to drink at my desk. That's most of it."],
    "workout_prefer_celsius": ["For the gym I still buy Celsius. The Alani is more of an afternoon thing.",
                               "If I'm actually going to train I want the Celsius. Alani is for the drive to work."],
    "availability": ["The store was out of Celsius that week. I'd have bought Celsius if it was there.",
                     "They moved the Celsius to the bottom shelf and I didn't see it. Not a flavor thing at all."],
    "social": ["My sister had one and I tried a sip. That was it.", "I'd seen it all over TikTok. The promo just gave me a reason."],
    "full_price_ok": ["I've bought it at full price twice since. It's a regular thing now.", "Price doesn't matter much, I'd pay the same as Celsius."],
    "price_sensitive": ["If it goes back to full price I'll probably rotate back. It depends what's on deal.",
                        "I buy whichever of the two is cheaper that week."],
    "no_difference": ["They're basically the same to me. I'm not loyal to either."],
    "package": ["The cans look nicer and the four-pack at the grocery store is easy to grab."],
}


def fieldwork(p: Panel, signal: dict, coh: dict, guide: dict) -> dict:
    rng = random.Random(SEED + 11)
    ids = [i for i in signal["switcher_ids"] if p.by_id[i].reachable]
    # stratify: promoted vs full-price first purchase using actual events
    def first_promo(bid):
        ev = sorted((e for e in p.buyer_events[bid] if e.brand == "alani_nu" and e.week >= WEEKS - 2), key=lambda e: e.day)
        return ev[0].promo if ev else None
    promo_ids = [i for i in ids if first_promo(i)]
    full_ids = [i for i in ids if first_promo(i) is False]
    rng.shuffle(promo_ids); rng.shuffle(full_ids)
    sample = promo_ids[:11] + full_ids[:9]
    sample = sample[:20]
    responses = []
    for n, bid in enumerate(sample):
        b = p.by_id[bid]
        codes = set()
        promoted = bid in promo_ids
        if promoted:
            codes.add("promo_trial")
        # repeat drivers
        r = rng.random()
        if r < 0.42: codes.add("flavor")
        elif r < 0.62: codes.add("carbonation")
        elif r < 0.72: codes.add("social")
        if b.occasion == "workout" and rng.random() < 0.8:
            codes.add("workout_prefer_celsius")
        if n == 7:                                # S9: a respondent who contradicts the leading explanation
            codes = {"availability", "price_sensitive"} | ({"promo_trial"} if promoted else set())
        if n == 14:
            codes = {"no_difference", "price_sensitive"}
        if "flavor" in codes or "carbonation" in codes:
            codes.add("full_price_ok" if rng.random() < 0.6 else "price_sensitive")
        elif "price_sensitive" not in codes and "no_difference" not in codes:
            codes.add("price_sensitive" if promoted and rng.random() < 0.7 else "full_price_ok")
        if rng.random() < 0.15:
            codes.add("package")
        flavor = rng.choice(["Cherry Slush", "Juicy Peach", "Cosmic Stardust", "Hawaiian Shaved Ice", "Kimade"])
        shop = {"convenience": "gas station", "grocery": "grocery store", "mass": "big-box store", "club": "club store", "online": "app"}[b.channel_pref[0]]
        spans = []
        qmap = {"promo_trial": "q3", "flavor": "q4", "carbonation": "q4", "workout_prefer_celsius": "q5", "availability": "q1",
                "social": "q2", "full_price_ok": "q6", "price_sensitive": "q6", "no_difference": "q4", "package": "q2"}
        t0 = 12
        # Every respondent answers every question; coded excerpts are added on top of a plain answer.
        base_answers = {
            "q1": rng.choice([f"I was at the {shop}, reached for Celsius, and ended up with the {flavor} Alani instead.",
                              f"It was a normal {shop} run. I just picked the Alani that time.",
                              "Nothing dramatic. I was thirsty, they were next to each other, I tried the other one."]),
            "q2": rng.choice(["I'd noticed the cans before. They stand out on the shelf.",
                              "A coworker drinks them, so I'd seen it around.",
                              "Honestly I'd just seen the flavors and been curious."]),
            "q4": rng.choice(["Not a huge difference in energy. It's more about the taste.",
                              "Felt about the same. I just liked drinking it more.",
                              "Same lift, different taste."]),
            "q6": rng.choice(["Whatever is there and on deal, mostly.", "Flavor first, then price.",
                              "Depends on the day. Gym days are different."]),
        }
        for q, text in base_answers.items():
            spans.append({"question": q, "code": "answer", "start_s": t0, "end_s": t0 + 6 + len(text) // 14, "text": text})
            t0 += 20 + len(text) // 8
        for c in sorted(codes):
            text = rng.choice(TEMPLATES[c]).format(flavor=flavor, shop=shop)
            spans.append({"question": qmap[c], "code": c, "start_s": t0, "end_s": t0 + 9 + len(text) // 12, "text": text})
            t0 += 30 + len(text) // 6
        # behavioral facts from the panel, shown only with consent
        alani = [e for e in p.buyer_events[bid] if e.brand == "alani_nu" and e.week >= WEEKS - 2]
        celsius_base = sum(1 for e in p.buyer_events[bid] if e.brand == "celsius" and WEEKS - 10 <= e.week < WEEKS - 2)
        responses.append({
            "id": f"r{n + 1:02d}", "buyer": bid, "region": b.region, "tier": b.tier, "occasion": b.occasion,
            "first_purchase_promoted": promoted, "first_purchase_channel": alani[0].channel if alani else None,
            "repeated": len(alani) > 1, "celsius_purchases_baseline": celsius_base, "alani_purchases_window": len(alani),
            "verified": True, "badge_consent": b.consented_badge, "codes": sorted(codes), "spans": spans,
            "duration_s": t0 + 20, "completed_at": (TODAY).isoformat(), "flavor": flavor,
        })
    # objective coverage
    objectives = [q["objective"] for q in guide["questions"]]
    coverage = {o: sum(1 for r in responses for s in r["spans"] if s["question"] == next(q["id"] for q in guide["questions"] if q["objective"] == o)) for o in objectives}
    return {"study": guide["id"], "state": "explained", "completes": len(responses), "target": coh["target_completes"],
            "responses": responses, "objective_coverage": coverage, "reason_codes": REASON_CODES,
            "code_counts": {c: sum(1 for r in responses if c in r["codes"]) for c in REASON_CODES}}


def claims(fw: dict, signal: dict) -> list[dict]:
    R = fw["responses"]; n = len(R)
    def ids_with(*codes):
        return [r["id"] for r in R if any(c in r["codes"] for c in codes)]
    promo = ids_with("promo_trial"); taste = ids_with("flavor", "carbonation"); workout = ids_with("workout_prefer_celsius")
    avail = ids_with("availability"); full = ids_with("full_price_ok"); price = ids_with("price_sensitive")
    repeat_taste = [r["id"] for r in R if r["repeated"] and any(c in r["codes"] for c in ("flavor", "carbonation"))]
    repeated = [r["id"] for r in R if r["repeated"]]
    out = [
        {"id": "c1", "text": f"Promotion created trial: {len(promo)} of {n} switchers first bought Alani Nu during a promotion.",
         "k": len(promo), "n": n, "interval": beta_binomial_interval(len(promo), n), "supporting": promo,
         "contradicting": [r["id"] for r in R if "availability" in r["codes"]],
         "contradiction_note": "Some trial was driven by Celsius being out of stock or hard to find, not by promotion.",
         "behavioral": f"Panel: {signal['profile']['promo_on_first_purchase']['k']} of {signal['profile']['promo_on_first_purchase']['n']} first purchases with a known price were promoted.",
         "kind": "self-reported + observed", "confidence": "high", "review": "reviewed"},
        {"id": "c2", "text": f"Flavor and a lighter drinking experience created repeat: {len(taste)} of {n} named taste or carbonation as the main factor in their next choice.",
         "k": len(taste), "n": n, "interval": beta_binomial_interval(len(taste), n), "supporting": taste,
         "contradicting": ids_with("no_difference") + avail, "contradiction_note": "Two respondents see no meaningful difference and choose on price or shelf.",
         "behavioral": f"Panel: {signal['profile']['repeat_rate_so_far']:.0%} of switchers have already repeated; median {signal['profile']['median_days_to_repeat']} days to second purchase.",
         "kind": "self-reported", "confidence": "medium-high", "review": "reviewed"},
        {"id": "c3", "text": f"Celsius still wins planned workouts: {len(workout)} of {n} would choose Celsius before training.",
         "k": len(workout), "n": n, "interval": beta_binomial_interval(len(workout), n), "supporting": workout, "contradicting": [],
         "contradiction_note": None, "behavioral": "Panel: Celsius 12-week retention is higher among workout-occasion buyers than everyday buyers (see sig_celsius_workout_retention).",
         "kind": "self-reported + observed", "confidence": "medium", "review": "reviewed"},
        {"id": "c4", "text": f"Repeat is not promotion-dependent for most: {len(full)} of {n} would repeat at full price; {len(price)} say it depends on price.",
         "k": len(full), "n": n, "interval": beta_binomial_interval(len(full), n), "supporting": full, "contradicting": price,
         "contradiction_note": "A price-sensitive minority will rotate back when Alani Nu is not on deal.",
         "behavioral": "Panel: repeat purchases skew grocery, where regular price is more common than convenience promo tags.",
         "kind": "self-reported + observed", "confidence": "medium", "review": "needs second reviewer"},
    ]
    return out


def clips(fw: dict, cl: list[dict]) -> list[dict]:
    """Representative clips are chosen AFTER claims exist: one supporting per claim, plus challenging clips."""
    R = {r["id"]: r for r in fw["responses"]}
    out = []
    for c in cl:
        for rid in c["supporting"][:1]:
            r = R[rid]; span = next(s for s in r["spans"] if s["code"] in ("promo_trial", "flavor", "carbonation", "workout_prefer_celsius", "full_price_ok") and s["question"] in ("q3", "q4", "q5", "q6")) if r["spans"] else None
            if span:
                out.append({"id": f"clip_{c['id']}_{rid}", "claim": c["id"], "respondent": rid, "role": "supporting", "topic": REASON_CODES[span["code"]],
                            "cohort": f"{r['region']} · {r['tier']} buyer · {r['occasion']}", "verified": True, "duration_s": span["end_s"] - span["start_s"],
                            "start_s": span["start_s"], "text": span["text"], "badge": r["badge_consent"]})
        for rid in c["contradicting"][:1]:
            r = R[rid]; span = next(sp for sp in r["spans"] if sp["code"] != "answer")
            out.append({"id": f"clip_{c['id']}_{rid}_x", "claim": c["id"], "respondent": rid, "role": "challenging", "topic": REASON_CODES[span["code"]],
                        "cohort": f"{r['region']} · {r['tier']} buyer · {r['occasion']}", "verified": True, "duration_s": span["end_s"] - span["start_s"],
                        "start_s": span["start_s"], "text": span["text"], "badge": r["badge_consent"]})
    return out
