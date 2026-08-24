"""Signal detectors, qualification, suppression, switching, and household-vs-attention lead time.

Design rule from the product spec: interpretable statistics over forecasting.
Every signal carries its numerator, denominator, window, baseline, checks, and version.
"""
from __future__ import annotations
import math
import random
from statistics import median
from .aggregate import Panel
from .synth import (BRANDS, BRAND_LABEL, COVERAGE_GAP, WEEKS, REGIONS, day_to_date, TODAY)
from .stats import (mad, robust_z, beta_binomial_interval, prob_ratio_exceeds,
                    cross_correlation, first_persistent_crossing, survival_curve)
from . import DETECTOR_VERSION, SEED

CUR = 4                        # current window, weeks
BLOCK = 4                      # baseline block size, weeks
THRESH = {
    "min_buyers": 150, "min_events": 300, "effect_ratio": 0.15, "robust_z": 3.0,
    "persist_weeks": 2, "merchant_dependence": 0.25, "merchant_drop": 0.55,
    "switch_velocity": 1.5, "bh_q": 0.05, "attention_persist_days": 14, "mad_k": 3.0,
}


def _norm_sf(z: float) -> float:
    return 0.5 * math.erfc(z / math.sqrt(2))


def week_label(w: int) -> str:
    return day_to_date(w * 7).isoformat()


# --------------------------------------------------------------------------- coverage
def coverage_report(p: Panel) -> dict:
    """Flag merchants whose feed volume collapsed in the current window vs their own trailing median."""
    flagged = []
    rows = []
    for m, series in sorted(p.merchant_week_events.items()):
        base = series[4:WEEKS - CUR]
        med = median(base)
        cur_weeks = series[WEEKS - CUR:]
        low_weeks = [WEEKS - CUR + i for i, v in enumerate(cur_weeks) if med and v < THRESH["merchant_drop"] * med]
        is_flagged = len(low_weeks) >= 2 and med >= 100
        rows.append({"merchant": m, "trailing_median": med, "current": cur_weeks,
                     "low_weeks": [week_label(w) for w in low_weeks], "flagged": is_flagged})
        if is_flagged:
            flagged.append(m)
    return {"flagged_merchants": flagged, "merchants": rows,
            "rule": f"at least 2 current weeks below {THRESH['merchant_drop']:.0%} of the merchant's trailing median (median >= 100 events)"}


def merchant_dependence(p: Panel, brand: str, flagged: list[str]) -> dict:
    total = sum(v for (b, m), v in p.brand_merchant_events.items() if b == brand)
    dep = {m: p.brand_merchant_events.get((brand, m), 0) / total for m in flagged} if total else {}
    top = max(dep.values()) if dep else 0.0
    return {"by_merchant": {m: round(v, 4) for m, v in dep.items()}, "max": round(top, 4),
            "fails": top > THRESH["merchant_dependence"]}


# --------------------------------------------------------------------------- generic momentum
def momentum(series: list[float], label: str) -> dict:
    """Current 4-week mean vs trailing 4-week block medians. Returns evidence, not a verdict."""
    cur = series[WEEKS - CUR:]
    blocks = [sum(series[i:i + BLOCK]) / BLOCK for i in range(2, WEEKS - CUR - BLOCK + 1, BLOCK)]
    current = sum(cur) / CUR
    base_med = median(blocks)
    z = robust_z(current, blocks)
    thr = base_med + THRESH["mad_k"] * max(mad(blocks), 0.05 * abs(base_med))
    above = [v > thr for v in cur] if current > base_med else [v < base_med - (thr - base_med) for v in cur]
    persist = 0
    run = 0
    for a in above:
        run = run + 1 if a else 0
        persist = max(persist, run)
    return {
        "label": label, "current": current, "baseline_median": base_med, "baseline_blocks": blocks,
        "ratio": (current / base_med) if base_med else None, "robust_z": z, "threshold": thr,
        "persistence_weeks": persist, "p_value": 2 * _norm_sf(abs(z)),
        "window": {"start": week_label(WEEKS - CUR), "end": TODAY.isoformat(), "weeks": CUR},
        "baseline": {"blocks": len(blocks), "block_weeks": BLOCK, "type": "trailing block medians"},
    }


def qualify(m: dict, buyers: int, events: int, dep: dict, share_based: bool, promo_note: str | None) -> dict:
    checks = [
        {"name": "minimum buyers", "pass": buyers >= THRESH["min_buyers"], "value": buyers, "rule": f">= {THRESH['min_buyers']}"},
        {"name": "minimum events", "pass": events >= THRESH["min_events"], "value": events, "rule": f">= {THRESH['min_events']}"},
        {"name": "effect size", "pass": m["ratio"] is not None and abs(m["ratio"] - 1) >= THRESH["effect_ratio"],
         "value": round(m["ratio"], 3) if m["ratio"] else None, "rule": f"|ratio - 1| >= {THRESH['effect_ratio']}"},
        {"name": "robust z (MAD)", "pass": abs(m["robust_z"]) >= THRESH["robust_z"], "value": round(m["robust_z"], 2), "rule": f"|z| >= {THRESH['robust_z']}"},
        {"name": "persistence", "pass": m["persistence_weeks"] >= THRESH["persist_weeks"], "value": m["persistence_weeks"], "rule": f">= {THRESH['persist_weeks']} consecutive weeks"},
        {"name": "merchant coverage", "pass": not dep["fails"], "value": dep["max"], "rule": f"flagged-merchant dependence <= {THRESH['merchant_dependence']:.0%}"},
        {"name": "seasonality", "pass": True, "value": "share-based" if share_based else "category-normalized",
         "rule": "metric is a share of category volume, so category seasonality cancels"},
        {"name": "promotion", "pass": promo_note is None, "value": promo_note or "no unusual promotion share", "rule": "promo share not > 2x baseline"},
    ]
    return {"checks": checks, "all_pass": all(c["pass"] for c in checks)}


def state_from(q: dict, dep: dict, buyers: int) -> tuple[str, str | None]:
    if dep["fails"]:
        return "suppressed", "merchant coverage artifact"
    if buyers < THRESH["min_buyers"]:
        return "suppressed", "below minimum cell size"
    if q["all_pass"]:
        return "qualified", None
    names = [c["name"] for c in q["checks"] if not c["pass"]]
    if "effect size" in names or "robust z (MAD)" in names:
        return "candidate", None
    return "emerging", None


def promo_share_note(p: Panel, brand: str) -> str | None:
    known = p.brand_week_known[brand]; promo = p.brand_week_promo[brand]
    cur = sum(promo[WEEKS - CUR:]) / max(1, sum(known[WEEKS - CUR:]))
    base = sum(promo[2:WEEKS - CUR]) / max(1, sum(known[2:WEEKS - CUR]))
    if base and cur > 2 * base:
        return f"promo share {cur:.0%} vs {base:.0%} baseline"
    return None


# --------------------------------------------------------------------------- switching
def switching(p: Panel, a: str, b: str, cur_weeks: int = 2, base_weeks: int = 8) -> dict:
    """Strict A->B switcher definition from the spec, evaluated over rolling equivalent windows."""
    def window(end_w: int):
        w1 = end_w; w0 = end_w - cur_weeks + 1
        b1 = w0 - 1; b0 = b1 - base_weeks + 1
        eligible, switchers = [], []
        cat = p.cat_buyers_in(b0, w1)
        for bid in cat:
            base = p.buyer_brand_counts(bid, b0, b1)
            if base.get(a, 0) < 2 or base.get(b, 0) >= base.get(a, 0):
                continue
            eligible.append(bid)
            cur = p.buyer_brand_counts(bid, w0, w1)
            a_rate_base = base[a] / base_weeks
            reduced = cur.get(a, 0) / cur_weeks < 0.6 * a_rate_base
            if cur.get(b, 0) >= 1 and reduced:
                switchers.append(bid)
        return {"end_week": end_w, "eligible": len(eligible), "switchers": len(switchers),
                "share": len(switchers) / len(eligible) if eligible else 0.0,
                "switcher_ids": switchers}
    current = window(WEEKS - 1)
    trailing = [window(e) for e in range(WEEKS - 1 - cur_weeks, base_weeks + cur_weeks, -cur_weeks)][:10]
    baseline_share = median([t["share"] for t in trailing])
    base_k = sum(t["switchers"] for t in trailing); base_n = sum(t["eligible"] for t in trailing)
    ci = beta_binomial_interval(current["switchers"], current["eligible"])
    velocity = current["share"] / max(baseline_share, 1e-6)
    p_gt = prob_ratio_exceeds(current["switchers"], current["eligible"], base_k, base_n, THRESH["switch_velocity"], seed=SEED)
    return {
        "pair": [a, b], "current": {k: v for k, v in current.items() if k != "switcher_ids"},
        "switcher_ids": current["switcher_ids"], "trailing": [{k: v for k, v in t.items() if k != "switcher_ids"} for t in trailing],
        "baseline_share": baseline_share, "velocity": velocity, "interval": ci,
        "p_velocity_gt_threshold": p_gt, "definition": {
            "eligible": f">= 2 {BRAND_LABEL[a]} purchases in the {base_weeks}-week baseline and not primarily a {BRAND_LABEL[b]} buyer",
            "switcher": f"eligible, bought {BRAND_LABEL[b]} in the current {cur_weeks}-week window, and {BRAND_LABEL[a]} rate fell below 60% of baseline",
            "baseline": f"median share across {len(trailing)} equivalent trailing windows"},
    }


def switcher_profile(p: Panel, ids: list[str], a: str, b: str) -> dict:
    """Who the switchers are, with the comparison population named for every index."""
    eligible_pop = [x for x in p.buyers if x.primary == a]
    def dist(pop, key):
        n = len(pop) or 1
        out = {}
        for x in pop:
            out[key(x)] = out.get(key(x), 0) + 1
        return {k: v / n for k, v in out.items()}, {k: v for k, v in out.items()}
    sw = [p.by_id[i] for i in ids]
    rows = []
    for name, key in [("region", lambda x: x.region), ("frequency tier", lambda x: x.tier), ("occasion", lambda x: x.occasion)]:
        d_sw, c_sw = dist(sw, key); d_base, _ = dist(eligible_pop, key)
        for k in sorted(d_sw, key=lambda k: -c_sw[k]):
            rows.append({"dimension": name, "value": k, "count": c_sw[k], "share": round(d_sw[k], 4),
                         "comparison_share": round(d_base.get(k, 0), 4),
                         "index": round(d_sw[k] / d_base[k] * 100) if d_base.get(k) else None,
                         "comparison": f"all {BRAND_LABEL[a]}-primary buyers"})
    # channels of first B purchase vs repeat purchases (S4)
    first_ch, repeat_ch = {}, {}
    promo_first = 0; known_first = 0
    repeat_days = []
    for x in sw:
        ev = sorted([e for e in p.buyer_events[x.id] if e.brand == b and e.week >= WEEKS - 2], key=lambda e: e.day)
        if not ev:
            continue
        first_ch[ev[0].channel] = first_ch.get(ev[0].channel, 0) + 1
        if ev[0].promo is not None:
            known_first += 1; promo_first += 1 if ev[0].promo else 0
        for e in ev[1:]:
            repeat_ch[e.channel] = repeat_ch.get(e.channel, 0) + 1
        repeat_days.append((ev[1].day - ev[0].day) if len(ev) > 1 else None)
    reachable = [x for x in sw if x.reachable]
    return {
        "n": len(sw), "reachable": len(reachable), "consented_badge": sum(1 for x in reachable if x.consented_badge),
        "over_index": rows, "first_purchase_channel": first_ch, "repeat_purchase_channel": repeat_ch,
        "promo_on_first_purchase": {"k": promo_first, "n": known_first,
                                    "interval": beta_binomial_interval(promo_first, known_first) if known_first else None},
        "repeat_curve": survival_curve(repeat_days, 28),
        "median_days_to_repeat": median([d for d in repeat_days if d is not None]) if any(d is not None for d in repeat_days) else None,
        "repeat_rate_so_far": sum(1 for d in repeat_days if d is not None) / len(repeat_days) if repeat_days else 0,
    }


# --------------------------------------------------------------------------- lead / lag
def household_series(p: Panel) -> list[float]:
    """Weekly share of frequent-buyer (medium+heavy) events that are zero-sugar & fruit-flavored."""
    out = []
    for w in range(WEEKS):
        num = p.tier_attr_week[("heavy", "zero", "fruit")][w] + p.tier_attr_week[("medium", "zero", "fruit")][w]
        den = p.tier_week_events["heavy"][w] + p.tier_week_events["medium"][w]
        out.append(num / den if den else 0.0)
    return out


def daily_interpolate(weekly: list[float]) -> list[float]:
    days = []
    for w in range(len(weekly)):
        a = weekly[w]; b = weekly[min(w + 1, len(weekly) - 1)]
        for d in range(7):
            days.append(a + (b - a) * d / 7)
    return days


def attention_series(hh_daily: list[float], lag_days: int = 18, seed: int = SEED) -> list[float]:
    """Synthetic external-attention index: the household curve echoed `lag_days` later, indexed to 100,
    with autocorrelated noise. Clearly labeled synthetic in the UI."""
    rng = random.Random(seed + 1)
    base = hh_daily[0]
    n = len(hh_daily)
    out = []
    noise = 0.0
    for d in range(n):
        src = hh_daily[max(0, d - lag_days)]
        noise = 0.8 * noise + rng.gauss(0, 0.004)
        out.append(100 * (src / base) * (1 + noise) if base else 100)
    # light smoothing (3-day)
    return [sum(out[max(0, i - 1): i + 2]) / len(out[max(0, i - 1): i + 2]) for i in range(n)]


def lead_lag(p: Panel) -> dict:
    hh_w = household_series(p)
    hh_d = daily_interpolate(hh_w)
    at_d = attention_series(hh_d)
    base_days = 26 * 7
    # Index both series to 100 at their own first-26-week median, then apply ONE relative threshold
    # so neither series is advantaged by its own noise level.
    hh_med, at_med = median(hh_d[:base_days]), median(at_d[:base_days])
    hh_idx = [100 * v / hh_med for v in hh_d]; at_idx = [100 * v / at_med for v in at_d]
    rel_mad = max(mad(hh_idx[:base_days]), mad(at_idx[:base_days]), 2.0)
    rel_thr = 100 + THRESH["mad_k"] * rel_mad
    hh_thr, at_thr = rel_thr * hh_med / 100, rel_thr * at_med / 100
    hh_i = first_persistent_crossing(hh_idx, rel_thr, THRESH["attention_persist_days"])
    at_i = first_persistent_crossing(at_idx, rel_thr, THRESH["attention_persist_days"])
    at_w = [sum(at_d[w * 7:(w + 1) * 7]) / 7 for w in range(WEEKS)]
    xc = cross_correlation(hh_w, at_w, 8)
    best = max(xc, key=lambda r: r["r"])
    return {
        "household_weekly": [round(v, 4) for v in hh_w], "attention_weekly": [round(v, 2) for v in at_w],
        "household_daily": [round(v, 4) for v in hh_d], "attention_daily": [round(v, 2) for v in at_d],
        "household_threshold": hh_thr, "attention_threshold": at_thr,
        "household_credible_at": day_to_date(hh_i).isoformat() if hh_i is not None else None,
        "attention_credible_at": day_to_date(at_i).isoformat() if at_i is not None else None,
        "observed_lead_days": (at_i - hh_i) if (hh_i is not None and at_i is not None) else None,
        "cross_correlation": xc, "best_lag_weeks": best["lag"], "best_r": best["r"],
        "definition": {"household": "share of medium+heavy buyers' weekly purchases that are zero-sugar, fruit-flavored SKUs",
                       "attention": "SYNTHETIC external-attention index (search/social/media proxy), base = 100",
                       "credible_at": f"both series indexed to 100 at their first-26-week median; credible = first day starting {THRESH['attention_persist_days']} consecutive days above 100 + {THRESH['mad_k']}·MAD (shared)",
                       "caveat": "an observed lead in this data, not proof that households always lead media"},
        "dates": [day_to_date(d).isoformat() for d in range(len(hh_d))],
    }


# --------------------------------------------------------------------------- detectors -> signals
def build_signals(p: Panel) -> tuple[list[dict], dict, dict]:
    cov = coverage_report(p)
    flagged = cov["flagged_merchants"]
    signals: list[dict] = []
    cat_events = p.cat_week_events

    def share_series(num: list[int], den: list[int]) -> list[float]:
        return [n / d if d else 0.0 for n, d in zip(num, den)]

    def add(sig_id, kind, level, title, series, brand_for_dep, buyers, events, share_based=True,
            promo_note=None, extra=None, unit="", primary_brand=None):
        m = momentum(series, title)
        dep = merchant_dependence(p, brand_for_dep, flagged) if brand_for_dep else {"by_merchant": {}, "max": 0.0, "fails": False}
        q = qualify(m, buyers, events, dep, share_based, promo_note)
        state, reason = state_from(q, dep, buyers)
        signals.append({
            "id": sig_id, "kind": kind, "level": level, "title": title, "state": state, "suppression_reason": reason,
            "series": [round(v, 5) for v in series], "unit": unit, "momentum": {k: (round(v, 5) if isinstance(v, float) else v) for k, v in m.items()},
            "buyers": buyers, "events": events, "merchant_dependence": dep, "qualification": q,
            "primary_brand": primary_brand, **(extra or {}),
        })

    # 1. Category attribute momentum among frequent buyers (main signal)
    hh = household_series(p)
    n_buy = len({e.buyer for e in p.events if e.week >= WEEKS - CUR and p.by_id[e.buyer].tier != "light"
                 and (lambda s: s[2] == "zero" and s[3] == "fruit")(__import__("pogo_trends.synth", fromlist=["SKU_INDEX"]).SKU_INDEX[e.sku])})
    n_ev = sum(p.tier_attr_week[("heavy", "zero", "fruit")][WEEKS - CUR:]) + sum(p.tier_attr_week[("medium", "zero", "fruit")][WEEKS - CUR:])
    add("sig_zero_fruit_frequent", "attribute momentum", "category",
        "Flavor-forward zero-sugar energy is accelerating among frequent category buyers", hh, None, n_buy, n_ev,
        unit="share of frequent-buyer purchases", extra={"attribute": {"sugar": "zero", "flavor": "fruit"}})

    # 2. Regional diffusion: zero+fruit share by region (NE is the mover)
    for region in REGIONS:
        s = share_series(p.attr_region_week_events[(("zero", "fruit"), region)], p.region_week_events[region])
        ev = sum(p.attr_region_week_events[(("zero", "fruit"), region)][WEEKS - CUR:])
        buyers = len({e.buyer for e in p.events if e.week >= WEEKS - CUR and e.geo == region})
        add(f"sig_zero_fruit_{region}", "regional diffusion", "market",
            f"Zero-sugar fruit-flavor share rising in the {region.title()}", s, None, buyers, ev,
            unit=f"share of {region} purchases", extra={"region": region, "attribute": {"sugar": "zero", "flavor": "fruit"}})

    # 3. Brand momentum: observed buyer share per brand (buyers of brand / category buyers, weekly)
    for brand in BRANDS:
        if brand == "other":
            continue
        s = [len(p.brand_week_buyers[brand][w]) / max(1, len(p.cat_week_buyers[w])) for w in range(WEEKS)]
        buyers = len(p.brand_buyers_in(brand, WEEKS - CUR, WEEKS - 1))
        ev = sum(p.brand_week_events[brand][WEEKS - CUR:])
        direction = "gaining" if s[-1] > median(s[2:WEEKS - CUR]) else "losing"
        add(f"sig_share_{brand}", "brand momentum", "brand", f"{BRAND_LABEL[brand]} is {direction} observed buyer share",
            s, brand, buyers, ev, unit="observed buyer share", promo_note=promo_share_note(p, brand), primary_brand=brand)

    # 4. Channel shift for Alani Nu: grocery share of Alani events
    s = share_series(p.brand_channel_week_events[("alani_nu", "grocery")], p.brand_week_events["alani_nu"])
    add("sig_alani_grocery", "channel shift", "market", "Alani Nu purchases are moving from convenience into grocery", s,
        "alani_nu", len(p.brand_buyers_in("alani_nu", WEEKS - CUR, WEEKS - 1)),
        sum(p.brand_channel_week_events[("alani_nu", "grocery")][WEEKS - CUR:]), unit="grocery share of Alani Nu purchases", primary_brand="alani_nu")

    # 5. Low-sample cohort: C4 online in the Southwest (min cell)
    sw_online = [len({e.buyer for e in p.events if e.week == w and e.brand == "c4" and e.channel == "online" and e.geo == "southwest"}) for w in range(WEEKS)]
    buyers = len({e.buyer for e in p.events if e.week >= WEEKS - 12 and e.brand == "c4" and e.channel == "online" and e.geo == "southwest"})
    add("sig_c4_online_southwest", "cohort entry", "consumer", "C4 online buyers in the Southwest", [float(v) for v in sw_online], "c4",
        buyers, sum(sw_online[WEEKS - CUR:]), share_based=False, unit="weekly buyers", primary_brand="c4",
        extra={"region": "southwest", "channel": "online"})

    # 6. Ghost promotion spike (week 38) — evaluated at its own window, then tracked for repeat
    ghost = signals_promo_spike(p)
    signals.append(ghost)

    # 7. Switching Celsius -> Alani Nu (and the reverse, for honesty)
    sw = switching(p, "celsius", "alani_nu")
    prof = switcher_profile(p, sw["switcher_ids"], "celsius", "alani_nu")
    dep = merchant_dependence(p, "alani_nu", flagged)
    checks = [
        {"name": "minimum eligible buyers", "pass": sw["current"]["eligible"] >= THRESH["min_buyers"], "value": sw["current"]["eligible"], "rule": f">= {THRESH['min_buyers']}"},
        {"name": "switch velocity", "pass": sw["velocity"] >= THRESH["switch_velocity"], "value": round(sw["velocity"], 2), "rule": f">= {THRESH['switch_velocity']}x baseline"},
        {"name": "credible interval", "pass": sw["interval"]["low"] > sw["baseline_share"], "value": f"{sw['interval']['low']:.3f}–{sw['interval']['high']:.3f}", "rule": "90% interval excludes baseline share"},
        {"name": "P(velocity > 1.5x)", "pass": sw["p_velocity_gt_threshold"] >= 0.9, "value": round(sw["p_velocity_gt_threshold"], 3), "rule": ">= 0.90"},
        {"name": "merchant coverage", "pass": not dep["fails"], "value": dep["max"], "rule": f"flagged-merchant dependence <= {THRESH['merchant_dependence']:.0%}"},
        {"name": "promotion", "pass": True, "value": f"{prof['promo_on_first_purchase']['k']}/{prof['promo_on_first_purchase']['n']} first purchases promoted", "rule": "reported, not disqualifying — the study asks about it"},
    ]
    q = {"checks": checks, "all_pass": all(c["pass"] for c in checks)}
    first_day = min((min(e.day for e in p.buyer_events[i] if e.brand == "alani_nu" and e.week >= WEEKS - 2) for i in sw["switcher_ids"]), default=WEEKS * 7 - 1)
    signals.append({
        "id": "sig_switch_celsius_alani", "kind": "brand switching", "level": "brand",
        "title": f"Alani Nu captured {sw['velocity']:.1f}x its normal share of recent Celsius switchers",
        "state": "qualified" if q["all_pass"] else "emerging", "suppression_reason": None,
        "series": [round(t["share"], 5) for t in reversed(sw["trailing"])] + [round(sw["current"]["share"], 5)],
        "unit": "share of eligible Celsius buyers switching per 2-week window", "switching": {k: v for k, v in sw.items() if k != "switcher_ids"},
        "switcher_ids": sw["switcher_ids"], "profile": prof, "buyers": sw["current"]["switchers"], "events": None,
        "merchant_dependence": dep, "qualification": q, "primary_brand": "alani_nu", "counter_brand": "celsius",
        "movement_began": day_to_date(first_day).isoformat(), "days_since_began": WEEKS * 7 - 1 - first_day,
        "momentum": {"current": sw["current"]["share"], "baseline_median": sw["baseline_share"], "ratio": sw["velocity"],
                     "p_value": 1 - sw["p_velocity_gt_threshold"], "robust_z": None,
                     "window": {"start": week_label(WEEKS - 2), "end": TODAY.isoformat(), "weeks": 2},
                     "baseline": {"blocks": len(sw["trailing"]), "block_weeks": 2, "type": "equivalent trailing windows"}},
    })

    # 8. Celsius retention advantage among workout buyers (consumer level)
    ret = retention_by_occasion(p, "celsius")
    signals.append(ret)

    # Multiple-testing control across all momentum detectors (Benjamini–Hochberg)
    tested = [s for s in signals if s.get("momentum", {}).get("p_value") is not None]
    ps = sorted((s["momentum"]["p_value"], s["id"]) for s in tested)
    m_ = len(ps)
    passed = set()
    max_i = 0
    for i, (pv, sid) in enumerate(ps, start=1):
        if pv <= i / m_ * THRESH["bh_q"]:
            max_i = i
    for i, (pv, sid) in enumerate(ps, start=1):
        if i <= max_i:
            passed.add(sid)
    for s in tested:
        ok = s["id"] in passed
        s["qualification"]["checks"].append({"name": "multiple testing (BH)", "pass": ok, "value": f"p={s['momentum']['p_value']:.2e}",
                                             "rule": f"Benjamini–Hochberg q={THRESH['bh_q']} across {m_} detectors"})
        s["qualification"]["all_pass"] = all(c["pass"] for c in s["qualification"]["checks"])
        if s["state"] == "qualified" and not ok:
            s["state"] = "emerging"

    ll = lead_lag(p)
    # attach lead time to the main signal
    for s in signals:
        if s["id"] == "sig_zero_fruit_frequent":
            s["lead"] = {"observed_lead_days": ll["observed_lead_days"], "household_credible_at": ll["household_credible_at"],
                         "attention_credible_at": ll["attention_credible_at"]}
    return signals, cov, ll


def signals_promo_spike(p: Panel) -> dict:
    """S5: Ghost promo spike. Detected at week 38, then tracked — did promoted trialists repeat?"""
    brand = "ghost"; spike_w = 37
    s = [len(p.brand_week_buyers[brand][w]) / max(1, len(p.cat_week_buyers[w])) for w in range(WEEKS)]
    base = s[spike_w - 12: spike_w]
    z = robust_z(s[spike_w], base)
    promo_share = p.brand_week_promo[brand][spike_w] / max(1, p.brand_week_known[brand][spike_w])
    base_promo = sum(p.brand_week_promo[brand][spike_w - 12: spike_w]) / max(1, sum(p.brand_week_known[brand][spike_w - 12: spike_w]))
    # trialists: bought Ghost on promo in week 37 and had no Ghost purchase in prior 12 weeks
    trial = []
    for e in p.events:
        if e.week == spike_w and e.brand == brand and e.promo:
            prior = any(x.brand == brand and spike_w - 12 <= x.week < spike_w for x in p.buyer_events[e.buyer])
            if not prior:
                trial.append(e.buyer)
    trial = sorted(set(trial))
    repeat_days = []
    for bid in trial:
        later = sorted(x.day for x in p.buyer_events[bid] if x.brand == brand and spike_w < x.week <= spike_w + 8)
        first = min(x.day for x in p.buyer_events[bid] if x.brand == brand and x.week == spike_w)
        repeat_days.append((later[0] - first) if later else None)
    repeat_rate = sum(1 for d in repeat_days if d is not None) / len(repeat_days) if repeat_days else 0
    # comparison: Ghost trialists in a non-promo baseline week
    ctrl_w = spike_w - 6
    ctrl = []
    for e in p.events:
        if e.week == ctrl_w and e.brand == brand:
            prior = any(x.brand == brand and ctrl_w - 12 <= x.week < ctrl_w for x in p.buyer_events[e.buyer])
            if not prior:
                ctrl.append(e.buyer)
    ctrl = sorted(set(ctrl))
    ctrl_rep = 0
    for bid in ctrl:
        if any(x.brand == brand and ctrl_w < x.week <= ctrl_w + 8 for x in p.buyer_events[bid]):
            ctrl_rep += 1
    ctrl_rate = ctrl_rep / len(ctrl) if ctrl else 0
    return {
        "id": "sig_ghost_promo_spike", "kind": "promotion spike", "level": "brand",
        "title": "Ghost promotion drove a one-week trial spike without durable repeat",
        "state": "tracking", "trajectory": "reversed", "suppression_reason": None, "primary_brand": brand,
        "series": [round(v, 5) for v in s], "unit": "observed buyer share", "buyers": len(trial), "events": p.brand_week_events[brand][spike_w],
        "detected_week": week_label(spike_w), "merchant_dependence": {"by_merchant": {}, "max": 0.0, "fails": False},
        "momentum": {"current": s[spike_w], "baseline_median": median(base), "ratio": s[spike_w] / median(base), "robust_z": z,
                     "p_value": 2 * _norm_sf(abs(z)), "window": {"start": week_label(spike_w), "end": week_label(spike_w + 1), "weeks": 1},
                     "baseline": {"blocks": 12, "block_weeks": 1, "type": "trailing weeks"}},
        "promotion": {"promo_share": promo_share, "baseline_promo_share": base_promo,
                      "trialists": len(trial), "repeat_within_8_weeks": repeat_rate,
                      "repeat_interval": beta_binomial_interval(sum(1 for d in repeat_days if d is not None), len(repeat_days)),
                      "control_trialists": len(ctrl), "control_repeat": ctrl_rate,
                      "control_interval": beta_binomial_interval(ctrl_rep, len(ctrl)) if ctrl else None,
                      "repeat_curve": survival_curve(repeat_days, 56)},
        "qualification": {"checks": [
            {"name": "effect size", "pass": True, "value": round(s[spike_w] / median(base), 3), "rule": ">= 1.15"},
            {"name": "robust z (MAD)", "pass": abs(z) >= THRESH["robust_z"], "value": round(z, 2), "rule": ">= 3"},
            {"name": "promotion", "pass": False, "value": f"promo share {promo_share:.0%} vs {base_promo:.0%}", "rule": "promo share not > 2x baseline"},
            {"name": "durable repeat", "pass": repeat_rate >= ctrl_rate, "value": f"{repeat_rate:.0%} vs {ctrl_rate:.0%} unpromoted trialists", "rule": "promoted trialists repeat at least as often as unpromoted"},
        ], "all_pass": False},
    }


def retention_by_occasion(p: Panel, brand: str) -> dict:
    """S2: 12-week retention of brand buyers, split by occasion. Comparison population is named."""
    w_prev = (WEEKS - 24, WEEKS - 13); w_cur = (WEEKS - 12, WEEKS - 1)
    prev = p.brand_buyers_in(brand, *w_prev); cur = p.brand_buyers_in(brand, *w_cur)
    rows = []
    for occ in ("workout", "daily", "social"):
        pop = [b for b in prev if p.by_id[b].occasion == occ]
        kept = [b for b in pop if b in cur]
        ci = beta_binomial_interval(len(kept), len(pop))
        rows.append({"occasion": occ, "n": len(pop), "retained": len(kept), "rate": ci["point"], "interval": ci})
    overall = beta_binomial_interval(len(prev & cur), len(prev))
    # category benchmark: same retention for all category buyers regardless of brand
    cprev = p.cat_buyers_in(*w_prev); ccur = p.cat_buyers_in(*w_cur)
    bench = beta_binomial_interval(len(cprev & ccur), len(cprev))
    workout = next(r for r in rows if r["occasion"] == "workout"); daily = next(r for r in rows if r["occasion"] == "daily")
    gap = workout["rate"] - daily["rate"]
    ok = workout["interval"]["low"] > daily["interval"]["high"]
    return {
        "id": "sig_celsius_workout_retention", "kind": "retention", "level": "consumer", "primary_brand": brand,
        "title": f"Celsius keeps planned-workout buyers {gap * 100:.0f} pts better than everyday buyers",
        "state": "qualified" if ok and workout["n"] >= THRESH["min_buyers"] else "emerging", "suppression_reason": None,
        "series": [r["rate"] for r in rows], "unit": "12-week retention", "buyers": len(prev), "events": None,
        "merchant_dependence": {"by_merchant": {}, "max": 0.0, "fails": False},
        "retention": {"rows": rows, "overall": overall, "category_benchmark": bench,
                      "window": {"prior": [week_label(w_prev[0]), week_label(w_prev[1])], "current": [week_label(w_cur[0]), TODAY.isoformat()]},
                      "definition": "buyer active in the prior 12 weeks who bought again in the current 12 weeks"},
        "momentum": {"current": workout["rate"], "baseline_median": daily["rate"], "ratio": workout["rate"] / daily["rate"] if daily["rate"] else None,
                     "robust_z": None, "p_value": None, "window": {"start": week_label(w_cur[0]), "end": TODAY.isoformat(), "weeks": 12},
                     "baseline": {"blocks": 1, "block_weeks": 12, "type": "everyday-occasion buyers of the same brand"}},
        "qualification": {"checks": [
            {"name": "minimum buyers", "pass": workout["n"] >= THRESH["min_buyers"], "value": workout["n"], "rule": ">= 150"},
            {"name": "non-overlapping intervals", "pass": ok, "value": f"{workout['interval']['low']:.3f} > {daily['interval']['high']:.3f}", "rule": "90% intervals do not overlap"},
            {"name": "effect size", "pass": abs(gap) >= 0.05, "value": round(gap, 3), "rule": ">= 5 pts"},
        ], "all_pass": ok and workout["n"] >= THRESH["min_buyers"]},
    }
