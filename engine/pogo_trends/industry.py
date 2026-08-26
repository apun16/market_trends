from __future__ import annotations
from collections import Counter
from statistics import median
from .aggregate import Panel
from .synth import BRANDS, BRAND_LABEL, WEEKS, REGIONS, CHANNELS, SKU_INDEX, N_BUYERS, day_to_date, TODAY
from .stats import beta_binomial_interval, survival_curve
from .detect import week_label

CUR12 = (WEEKS - 12, WEEKS - 1)
PREV12 = (WEEKS - 24, WEEKS - 13)


def _events_in(p: Panel, w0, w1):
    return [e for e in p.events if w0 <= e.week <= w1]


def industry(p: Panel) -> dict:
    cur_cat = p.cat_buyers_in(*CUR12); prev_cat = p.cat_buyers_in(*PREV12)
    cur_ev = _events_in(p, *CUR12); prev_ev = _events_in(p, *PREV12)
    brands = []
    for b in BRANDS:
        cb = p.brand_buyers_in(b, *CUR12); pb = p.brand_buyers_in(b, *PREV12)
        share = len(cb) / len(cur_cat); pshare = len(pb) / len(prev_cat)
        ev = [e for e in cur_ev if e.brand == b]
        known = [e for e in ev if e.promo is not None]
        brands.append({
            "brand": b, "label": BRAND_LABEL[b], "buyers": len(cb), "observed_share": round(share, 4),
            "delta_pts": round((share - pshare) * 100, 2), "penetration": round(len(cb) / N_BUYERS, 4),
            "frequency": round(len(ev) / len(cb), 2) if cb else 0, "events": len(ev),
            "purchase_share": round(len(ev) / len(cur_ev), 4),
            "prior_purchase_share": round(sum(1 for e in prev_ev if e.brand == b) / len(prev_ev), 4),
            "promo_share": round(sum(1 for e in known if e.promo) / len(known), 4) if known else None,
            "weekly_buyers": [len(p.brand_week_buyers[b][w]) for w in range(WEEKS)],
            "weekly_share": [round(len(p.brand_week_buyers[b][w]) / max(1, len(p.cat_week_buyers[w])), 4) for w in range(WEEKS)],
        })
    # growth decomposition: category buyers this period = retained + new (to category in 24w) ; lost = prev not cur
    earlier = p.cat_buyers_in(0, PREV12[0] - 1)
    new = cur_cat - prev_cat
    truly_new = new - earlier
    reactivated = new & earlier
    lost = prev_cat - cur_cat
    # frequency effect: events per retained buyer, current vs prior
    retained = cur_cat & prev_cat
    f_cur = sum(1 for e in cur_ev if e.buyer in retained) / len(retained)
    f_prev = sum(1 for e in prev_ev if e.buyer in retained) / len(retained)
    # attribute momentum: share of events by attribute, current 4 weeks vs trailing
    attrs = {}
    for e in p.events:
        s = SKU_INDEX[e.sku]
        for key in (("sugar", s[2]), ("flavor", s[3]), ("pack", s[4]), ("function", s[5])):
            attrs.setdefault(key, [0] * WEEKS)[e.week] += 1
    tot = p.cat_week_events
    attr_rows = []
    for (dim, val), series in sorted(attrs.items()):
        sh = [series[w] / tot[w] if tot[w] else 0 for w in range(WEEKS)]
        cur = sum(sh[WEEKS - 4:]) / 4; base = median(sh[2:WEEKS - 4])
        attr_rows.append({"dimension": dim, "value": val, "current_share": round(cur, 4), "baseline_share": round(base, 4),
                          "delta_pts": round((cur - base) * 100, 2), "weekly": [round(v, 4) for v in sh]})
    # region x channel matrix of buyers, current 12 weeks, with zero+fruit share per cell
    cells = []
    for r in REGIONS:
        for c in CHANNELS:
            ev = [e for e in cur_ev if e.geo == r and e.channel == c]
            zf = sum(1 for e in ev if SKU_INDEX[e.sku][2] == "zero" and SKU_INDEX[e.sku][3] == "fruit")
            pev = [e for e in prev_ev if e.geo == r and e.channel == c]
            cells.append({"region": r, "channel": c, "events": len(ev), "buyers": len({e.buyer for e in ev}),
                          "growth": round((len(ev) - len(pev)) / len(pev), 4) if pev else None,
                          "zero_fruit_share": round(zf / len(ev), 4) if ev else None})
    # brand flow matrix: primary brand in prior 12w (most purchased) -> primary in current 12w
    def primary_of(bid, w0, w1):
        c = p.buyer_brand_counts(bid, w0, w1)
        return max(c, key=c.get) if c else None
    flow = {}
    for bid in retained:
        a, b = primary_of(bid, *PREV12), primary_of(bid, *CUR12)
        if a and b and a != b:
            flow[(a, b)] = flow.get((a, b), 0) + 1
    flows = [{"from": a, "to": b, "buyers": n} for (a, b), n in sorted(flow.items(), key=lambda kv: -kv[1])]
    # repertoire: buyers with 2+ brands in current 12w
    multi = sum(1 for bid in cur_cat if len(p.buyer_brand_counts(bid, *CUR12)) >= 2)
    event_counts = sorted(len(p.buyer_events[b.id]) for b in p.buyers)
    state_counts = Counter(b.state for b in p.buyers)
    known_prices = sum(1 for e in p.events if e.regular is not None)
    known_promos = sum(1 for e in p.events if e.promo is not None)

    def percentile(values, q):
        return values[round((len(values) - 1) * q)] if values else 0

    quality = {
        "dataset_version": "2.0.0",
        "source": "deterministic synthetic longitudinal panel",
        "generation_model": "buyer-level multinomial-logit brand choice with stable latent preferences",
        "buyers": len(p.buyers),
        "events": len(p.events),
        "active_buyers": sum(1 for value in event_counts if value > 0),
        "zero_event_buyers": sum(1 for value in event_counts if value == 0),
        "events_per_buyer": {
            "p50": percentile(event_counts, .50),
            "p90": percentile(event_counts, .90),
            "p99": percentile(event_counts, .99),
        },
        "coverage": {
            "states": len(state_counts),
            "regions": len({b.region for b in p.buyers}),
            "channels": len({e.channel for e in p.events}),
            "smallest_state_panel": min(state_counts.values()),
            "largest_state_panel": max(state_counts.values()),
        },
        "unique_skus": len({e.sku for e in p.events}),
        "regular_price_completeness": round(known_prices / len(p.events), 4),
        "promotion_flag_completeness": round(known_promos / len(p.events), 4),
        "known_limitations": [
            "Synthetic purchase behavior is suitable for product demonstration, not external market estimation.",
            "Buyer geography is state-level; no household-level addresses or personally identifying data are generated.",
            "A documented merchant-feed outage is retained to exercise coverage-quality controls.",
        ],
    }
    return {
        "window": {"current": [week_label(CUR12[0]), TODAY.isoformat()], "prior": [week_label(PREV12[0]), week_label(PREV12[1] + 1)]},
        "panel": N_BUYERS, "category_buyers": len(cur_cat), "category_penetration": round(len(cur_cat) / N_BUYERS, 4),
        "category_events": len(cur_ev), "frequency": round(len(cur_ev) / len(cur_cat), 2),
        "brands": brands,
        "decomposition": {"prior_buyers": len(prev_cat), "retained": len(retained), "new_to_category": len(truly_new),
                          "reactivated": len(reactivated), "lost": len(lost), "current_buyers": len(cur_cat),
                          "frequency_current": round(f_cur, 3), "frequency_prior": round(f_prev, 3),
                          "repertoire_buyers": multi, "repertoire_share": round(multi / len(cur_cat), 4)},
        "attributes": attr_rows, "cells": cells, "flows": flows[:24], "quality": quality,
        "weekly_category_buyers": [len(s) for s in p.cat_week_buyers], "weeks": [week_label(w) for w in range(WEEKS)],
    }


def matchup(p: Panel, a: str = "celsius", b: str = "alani_nu", switcher_ids: list[str] | None = None) -> dict:
    cur_cat = p.cat_buyers_in(*CUR12)
    out = {"brands": [a, b], "labels": [BRAND_LABEL[a], BRAND_LABEL[b]], "window": [week_label(CUR12[0]), TODAY.isoformat()], "metrics": []}
    per = {}
    for brand in (a, b):
        cb = p.brand_buyers_in(brand, *CUR12); pb = p.brand_buyers_in(brand, *PREV12)
        ev = [e for e in p.events if e.brand == brand and CUR12[0] <= e.week <= CUR12[1]]
        known = [e for e in ev if e.promo is not None]
        # trial = first-ever brand purchase in weeks 36..43; repeat = another purchase within 28 days
        trial_times = []
        for bid in p.brand_buyers_in(brand, WEEKS - 16, WEEKS - 9):
            evs = sorted(e.day for e in p.buyer_events[bid] if e.brand == brand)
            first = evs[0]
            if (WEEKS - 16) * 7 <= first < (WEEKS - 8) * 7:
                later = [d for d in evs if d > first]
                trial_times.append((later[0] - first) if later and later[0] - first <= 28 else None)
        churn = len(pb - cb) / len(pb) if pb else 0
        # promo-led trial vs full-price repeat
        promo_first = full_repeat = 0; nfirst = nrep = 0
        for bid in cb:
            evs = sorted((e for e in p.buyer_events[bid] if e.brand == brand and e.week >= CUR12[0]), key=lambda e: e.day)
            if evs and evs[0].promo is not None:
                nfirst += 1; promo_first += 1 if evs[0].promo else 0
            for e in evs[1:]:
                if e.promo is not None:
                    nrep += 1; full_repeat += 0 if e.promo else 1
        per[brand] = {
            "buyers": len(cb), "observed_share": len(cb) / len(cur_cat), "penetration": len(cb) / N_BUYERS,
            "frequency": len(ev) / len(cb), "retention": len(pb & cb) / len(pb), "churn": churn,
            "trial_n": len(trial_times), "trial_to_repeat_28d": sum(1 for t in trial_times if t is not None) / len(trial_times) if trial_times else 0,
            "median_days_to_repeat": median([t for t in trial_times if t is not None]) if any(t is not None for t in trial_times) else None,
            "repeat_curve": survival_curve(trial_times, 28),
            "promo_share": sum(1 for e in known if e.promo) / len(known) if known else 0,
            "promo_on_first": promo_first / nfirst if nfirst else 0, "full_price_repeat": full_repeat / nrep if nrep else 0,
            "weekly_share": [round(len(p.brand_week_buyers[brand][w]) / max(1, len(p.cat_week_buyers[w])), 4) for w in range(WEEKS)],
            "by_region": {r: len([x for x in cb if p.by_id[x].region == r]) / len(cb) for r in REGIONS},
            "by_channel": {c: sum(1 for e in ev if e.channel == c) / len(ev) for c in CHANNELS},
            "by_occasion": {o: len([x for x in cb if p.by_id[x].occasion == o]) / len(cb) for o in ("workout", "daily", "social")},
        }
    ca, cb_ = p.brand_buyers_in(a, *CUR12), p.brand_buyers_in(b, *CUR12)
    overlap = ca & cb_
    # net flow: primary-brand transitions prior -> current between the two
    def primary_of(bid, w0, w1):
        c = p.buyer_brand_counts(bid, w0, w1)
        return max(c, key=c.get) if c else None
    ab = ba = 0
    for bid in (ca | cb_) & p.cat_buyers_in(*PREV12):
        x, y = primary_of(bid, *PREV12), primary_of(bid, *CUR12)
        if x == a and y == b: ab += 1
        if x == b and y == a: ba += 1
    # category benchmark
    cat_prev = p.cat_buyers_in(*PREV12)
    bench = {"retention": len(cat_prev & cur_cat) / len(cat_prev), "frequency": len(_events_in(p, *CUR12)) / len(cur_cat)}
    # switcher repeat curve vs. all Alani trialists (spec: cohort curves)
    sw_curve = None
    if switcher_ids:
        times = []
        for bid in switcher_ids:
            evs = sorted(e.day for e in p.buyer_events[bid] if e.brand == b and e.week >= WEEKS - 3)
            times.append((evs[1] - evs[0]) if len(evs) > 1 else None)
        sw_curve = survival_curve(times, 14)
    metrics = [
        ("observed buyer share", "observed_share", "pct"), ("penetration (of 25,000 panel)", "penetration", "pct"),
        ("purchase frequency (12w)", "frequency", "num"), ("12-week retention", "retention", "pct"), ("12-week churn", "churn", "pct"),
        ("trial → repeat within 28d", "trial_to_repeat_28d", "pct"), ("median days to repeat", "median_days_to_repeat", "num"),
        ("promo share of purchases", "promo_share", "pct"), ("promo on first purchase", "promo_on_first", "pct"), ("full-price repeat purchases", "full_price_repeat", "pct"),
    ]
    out["metrics"] = [{"label": l, "key": k, "format": f, a: per[a][k], b: per[b][k]} for l, k, f in metrics]
    out["per_brand"] = per
    out["overlap"] = {"a_only": len(ca - cb_), "b_only": len(cb_ - ca), "both": len(overlap), "share_of_a": len(overlap) / len(ca), "share_of_b": len(overlap) / len(cb_)}
    out["flow"] = {"a_to_b": ab, "b_to_a": ba, "net_to_b": ab - ba, "definition": "primary brand (most purchased) in prior 12 weeks → primary brand in current 12 weeks"}
    out["benchmark"] = bench
    out["switcher_repeat_curve"] = sw_curve
    return out


def buyer_summaries(p: Panel) -> dict:
    """Compact multi-window buyer table used by every dashboard calculation."""
    periods = (4, 8, 12, 24, 52)
    short = {"celsius": "celsius", "alani_nu": "alani", "monster": "monster", "red_bull": "redbull", "ghost": "ghost", "c4": "c4", "other": "other"}
    cols = ["id", "region", "state", "tier", "occasion", "primary", "reachable", "consent", "channel"]
    for period in periods:
        cols.extend([f"{short[brand]}{period}" for brand in BRANDS])
        cols.append(f"promo{period}")
        if period < 52:
            cols.extend([f"{short[brand]}_prev{period}" for brand in BRANDS])
    cols.append("last_week")
    rows = []
    for b in p.buyers:
        buyer_events = p.buyer_events[b.id]
        row = [b.id, b.region, b.state, b.tier, b.occasion, b.primary, 1 if b.reachable else 0, 1 if b.consented_badge else 0, b.channel_pref[0]]
        for period in periods:
            evs = [e for e in buyer_events if e.week >= WEEKS - period]
            counts = Counter(e.brand for e in evs)
            row.extend([counts.get(brand, 0) for brand in BRANDS])
            row.append(sum(1 for e in evs if e.promo))
            if period < 52:
                previous = Counter(e.brand for e in buyer_events if WEEKS - 2 * period <= e.week < WEEKS - period)
                row.extend([previous.get(brand, 0) for brand in BRANDS])
        row.append(max((e.week for e in buyer_events), default=-1))
        rows.append(row)
    return {"columns": cols, "rows": rows, "periods": list(periods), "window": [week_label(CUR12[0]), TODAY.isoformat()], "min_cell": 50}
