"""Deterministic synthetic energy-drink purchase panel.

25,000 verified buyers, 52 weeks, ~300k events, 7 brand groups, 5 channels, 5 regions.
Every scenario below is *planted* so the detectors have something real to find — and
two are planted so the detectors have something real to reject.

Planted cases (see build.py golden metrics for what the detectors recover):
  S1  Celsius -> Alani Nu switching burst, last 9 days, strongest NE frequent buyers
  S2  Celsius retention advantage among planned-workout buyers
  S3  Zero-sugar fruit-flavor attribute diffuses Southeast -> Northeast
  S4  Convenience trial followed by grocery repeat for Alani Nu switchers
  S5  Ghost promotion spike (week 38) with no durable repeat
  S6  Merchant coverage gap (weeks 47-49) that fakes a Monster decline
  S7  Low-sample cohort: C4 online buyers in the Southwest
  S8  External attention follows household evidence by 18 days (see detect.attention_series)
  S9  Interviews include respondents who contradict the leading explanation (research.py)
"""
from __future__ import annotations
import random
from dataclasses import dataclass, field
from datetime import date, timedelta
from . import SEED

WEEKS = 52
TODAY = date(2026, 8, 23)                 # last observed day (inclusive)
START = TODAY - timedelta(days=WEEKS * 7 - 1)
N_BUYERS = 25_000

BRANDS = ["celsius", "alani_nu", "monster", "red_bull", "ghost", "c4", "other"]
BRAND_LABEL = {"celsius": "Celsius", "alani_nu": "Alani Nu", "monster": "Monster",
               "red_bull": "Red Bull", "ghost": "Ghost", "c4": "C4", "other": "Other"}
BASE_SHARE = {"monster": .30, "red_bull": .25, "celsius": .17, "alani_nu": .10,
              "ghost": .07, "c4": .05, "other": .06}
REGIONS = {"northeast": .22, "southeast": .26, "midwest": .20, "west": .18, "southwest": .14}
CHANNELS = {"convenience": .40, "grocery": .30, "mass": .15, "club": .07, "online": .08}
MERCHANTS = {  # merchant -> (channel, brand it over-indexes on)
    "m_quickstop": ("convenience", "monster"), "m_7mart": ("convenience", "red_bull"),
    "m_gasgo": ("convenience", None), "m_freshway": ("grocery", "celsius"),
    "m_kroghurst": ("grocery", None), "m_bigbox": ("mass", None), "m_targetish": ("mass", "alani_nu"),
    "m_clubco": ("club", None), "m_amazonlike": ("online", "ghost"), "m_brandsite": ("online", "c4"),
}
# S6: this merchant feed is 70% missing in weeks 49..51 (zero-based 48..50), restored in week 52
COVERAGE_GAP = {"merchant": "m_quickstop", "weeks": (48, 49, 50), "retained": 0.30}

SKUS = []  # (sku_id, brand, sugar, flavor_family, pack, function)
def _mk(brand, rows):
    for i, (sugar, flavor, pack, func) in enumerate(rows):
        SKUS.append((f"{brand}_{i:02d}", brand, sugar, flavor, pack, func))
_mk("celsius",  [("zero","fruit","single","energy_fitness"),("zero","fruit","multipack","energy_fitness"),
                 ("zero","classic","single","energy_fitness"),("zero","dessert","single","energy_fitness"),
                 ("zero","fruit","single","energy_hydration")])
_mk("alani_nu", [("zero","fruit","single","energy"),("zero","dessert","single","energy"),
                 ("zero","fruit","multipack","energy"),("zero","fruit","single","energy_focus")])
_mk("monster",  [("full","classic","single","energy"),("zero","classic","single","energy"),
                 ("full","fruit","single","energy"),("zero","fruit","single","energy"),
                 ("full","classic","multipack","energy"),("zero","classic","multipack","energy")])
_mk("red_bull", [("full","classic","single","energy"),("zero","classic","single","energy"),
                 ("full","fruit","single","energy"),("full","classic","multipack","energy")])
_mk("ghost",    [("zero","dessert","single","energy_focus"),("zero","fruit","single","energy_focus"),
                 ("zero","fruit","multipack","energy_focus")])
_mk("c4",       [("zero","fruit","single","energy_fitness"),("zero","classic","single","energy_fitness"),
                 ("zero","fruit","multipack","energy_fitness")])
_mk("other",    [("full","classic","single","energy"),("zero","fruit","single","energy"),
                 ("full","fruit","single","energy")])
SKU_BY_BRAND = {b: [s for s in SKUS if s[1] == b] for b in BRANDS}
SKU_INDEX = {s[0]: s for s in SKUS}


@dataclass
class Buyer:
    id: str
    region: str
    tier: str            # light / medium / heavy
    rate_per_week: float
    primary: str
    secondary: str | None
    occasion: str        # workout / daily / social
    channel_pref: list[str]
    reachable: bool
    consented_badge: bool
    switched_to_alani_day: int | None = None
    switch_promo: bool = False
    churn_day: int | None = None
    churn_to: str | None = None


@dataclass
class Event:
    buyer: str
    day: int             # 0..WEEKS*7-1
    merchant: str
    channel: str
    brand: str
    sku: str
    qty: int
    net: float
    regular: float | None
    promo: bool | None
    geo: str
    batch: str

    @property
    def week(self) -> int:
        return self.day // 7


def _pick(rng, weights: dict):
    r = rng.random()
    acc = 0.0
    for k, w in weights.items():
        acc += w
        if r < acc:
            return k
    return k


def make_buyers(rng: random.Random) -> list[Buyer]:
    buyers = []
    for i in range(N_BUYERS):
        region = _pick(rng, REGIONS)
        tier = _pick(rng, {"light": .55, "medium": .30, "heavy": .15})
        rate = {"light": 5, "medium": 14, "heavy": 35}[tier] / 52 * rng.uniform(0.7, 1.3)
        occasion = _pick(rng, {"workout": .30, "daily": .55, "social": .15})
        share = dict(BASE_SHARE)
        if occasion == "workout":       # fitness-positioned brands over-index on workout occasions
            for b in ("celsius", "c4", "ghost"):
                share[b] *= 1.8
        if region == "southeast":
            share["celsius"] *= 1.15; share["alani_nu"] *= 1.25
        tot = sum(share.values()); share = {k: v / tot for k, v in share.items()}
        primary = _pick(rng, share)
        secondary = None
        if rng.random() < .45:
            rest = {k: v for k, v in share.items() if k != primary}
            t = sum(rest.values()); secondary = _pick(rng, {k: v / t for k, v in rest.items()})
        ch = list(CHANNELS)
        rng.shuffle(ch)
        # bias toward realistic channel: heavy buyers lean convenience, club buyers are rarer
        pref = sorted(ch, key=lambda c: -CHANNELS[c] * rng.uniform(0.5, 1.5))
        buyers.append(Buyer(
            id=f"b{i:05d}", region=region, tier=tier, rate_per_week=rate, primary=primary,
            secondary=secondary, occasion=occasion, channel_pref=pref[:3],
            reachable=rng.random() < .62, consented_badge=rng.random() < .35))
    return buyers


def _merchant_for(rng, channel, brand):
    cands = [m for m, (c, _) in MERCHANTS.items() if c == channel]
    w = {}
    for m in cands:
        w[m] = 1.0 + (1.6 if MERCHANTS[m][1] == brand else 0.0)
    t = sum(w.values())
    return _pick(rng, {k: v / t for k, v in w.items()})


def _sku_for(rng, brand, buyer: Buyer, day: int):
    skus = SKU_BY_BRAND[brand]
    w = []
    week = day // 7
    for s in skus:
        _, _, sugar, flavor, pack, _ = s
        x = 1.0
        if pack == "multipack":
            x *= 0.35 if buyer.channel_pref[0] in ("convenience",) else 0.8
        # S3: zero-sugar fruit flavor diffuses SE (from week 28) -> NE (from week 40)
        if sugar == "zero" and flavor == "fruit":
            if buyer.region == "southeast" and week >= 28:
                x *= 1.0 + min(1.0, (week - 28) / 10) * 1.6
            if buyer.region == "northeast" and week >= 40:
                x *= 1.0 + min(1.0, (week - 40) / 8) * 1.9
            if buyer.tier != "light" and week >= 42:
                x *= 1.0 + min(1.0, (week - 42) / 8) * 0.9
        w.append(x)
    t = sum(w)
    r = rng.random() * t
    acc = 0
    for s, x in zip(skus, w):
        acc += x
        if r < acc:
            return s
    return skus[-1]


PRICE = {"single": 2.79, "multipack": 9.49}


def generate(seed: int = SEED) -> tuple[list[Buyer], list[Event]]:
    rng = random.Random(seed)
    buyers = make_buyers(rng)
    events: list[Event] = []
    last_day = WEEKS * 7 - 1
    switch_window_start = last_day - 8            # S1: movement began 9 days ago

    for b in buyers:
        # S1 hazard: Celsius-primary buyers may switch to Alani Nu inside the burst window
        if b.primary == "celsius" and b.secondary != "alani_nu":
            haz = {"northeast": .20, "southeast": .075, "midwest": .04, "west": .035, "southwest": .03}[b.region]
            haz *= {"heavy": 1.45, "medium": 1.0, "light": 0.5}[b.tier]
            if b.occasion == "workout":
                haz *= 0.7                       # S2: workout loyalists switch less
            if rng.random() < haz:
                b.switched_to_alani_day = switch_window_start + rng.randint(0, 6)
                b.switch_promo = rng.random() < .55
        # background Celsius->Alani switching (baseline rate for the detector)
        # S2 + realism: some buyers churn from their primary brand mid-year. Everyday-occasion
        # Celsius buyers churn far more than planned-workout Celsius buyers.
        churn_p = 0.10
        if b.primary == "celsius":
            churn_p = {"workout": 0.05, "daily": 0.24, "social": 0.20}[b.occasion]
        if b.switched_to_alani_day is None and rng.random() < churn_p:
            b.churn_day = rng.randint(30 * 7, 44 * 7)
            rest = {k: v for k, v in BASE_SHARE.items() if k != b.primary}
            t = sum(rest.values()); b.churn_to = _pick(rng, {k: v / t for k, v in rest.items()})

        # Poisson-ish arrival process by week
        for w in range(WEEKS):
            lam = b.rate_per_week * (1.0 + 0.15 * (1 if 18 <= w <= 34 else -0.5))   # summer seasonality
            n = 0
            p = rng.random()
            # small Poisson sampler
            L = 2.718281828 ** (-lam); k = 0; pp = 1.0
            while True:
                pp *= p if k == 0 else rng.random()
                if pp < L:
                    break
                k += 1
            days = [w * 7 + rng.randint(0, 6) for _ in range(k)]
            if b.switched_to_alani_day is not None and b.switched_to_alani_day // 7 == w:
                days.append(b.switched_to_alani_day)          # the trial purchase itself
            for day in days:
                # brand choice
                r = rng.random()
                if b.switched_to_alani_day is not None and day >= b.switched_to_alani_day:
                    # S2: workout switchers drift back to Celsius more often
                    keep = 0.45 if b.occasion == "workout" else 0.75
                    brand = "alani_nu" if r < keep else ("celsius" if r < 0.95 else _pick(rng, BASE_SHARE))
                elif b.churn_day is not None and day >= b.churn_day:
                    brand = b.churn_to if r < .70 else (b.secondary if (b.secondary and r < .85) else _pick(rng, BASE_SHARE))
                elif r < .75:
                    brand = b.primary
                elif r < .95 and b.secondary:
                    brand = b.secondary
                else:
                    brand = _pick(rng, BASE_SHARE)
                # S5: Ghost promo spike week 38 (index 37): promoted trial with low repeat
                promo = None
                if w == 37 and brand != "ghost" and rng.random() < .045:
                    brand = "ghost"; promo = True
                sku = _sku_for(rng, brand, b, day)
                # channel
                channel = b.channel_pref[0] if rng.random() < .6 else rng.choice(b.channel_pref)
                if b.switched_to_alani_day is not None and brand == "alani_nu":
                    # S4: first Alani purchase skews convenience; repeats skew grocery
                    first = day - b.switched_to_alani_day < 3
                    channel = "convenience" if (first and rng.random() < .75) else (
                        "grocery" if rng.random() < .80 else channel)
                merchant = _merchant_for(rng, channel, brand)
                # S6: coverage gap
                if merchant == COVERAGE_GAP["merchant"] and w in COVERAGE_GAP["weeks"] \
                        and rng.random() > COVERAGE_GAP["retained"]:
                    continue
                pack = SKU_INDEX[sku[0]][4]
                regular = PRICE[pack] * (0.9 if channel in ("club", "mass") else 1.0)
                if promo is None:
                    if b.switched_to_alani_day is not None and brand == "alani_nu" and \
                            day - b.switched_to_alani_day < 3:
                        promo = b.switch_promo
                    else:
                        promo = rng.random() < (.18 if channel in ("mass", "grocery") else .08)
                net = round(regular * (0.75 if promo else 1.0), 2)
                if rng.random() < .07:
                    regular_out, promo_out = None, None      # unknown regular price for some merchants
                else:
                    regular_out, promo_out = round(regular, 2), promo
                events.append(Event(
                    buyer=b.id, day=day, merchant=merchant, channel=channel, brand=brand,
                    sku=sku[0], qty=1 if pack == "single" else rng.choice([1, 1, 2]),
                    net=net, regular=regular_out, promo=promo_out, geo=b.region,
                    batch=f"batch_{w:02d}"))
    events.sort(key=lambda e: (e.day, e.buyer))
    return buyers, events


def day_to_date(day: int) -> date:
    return START + timedelta(days=day)
