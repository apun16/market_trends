from __future__ import annotations
import math
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
STATE_WEIGHTS = {
    "northeast": {"ME": .03, "NH": .03, "VT": .015, "MA": .12, "RI": .02, "CT": .07, "NY": .31, "NJ": .17, "PA": .24},
    "southeast": {"DE": .02, "MD": .08, "VA": .10, "WV": .03, "NC": .11, "SC": .06, "GA": .10, "FL": .20, "KY": .05, "TN": .07, "AL": .05, "MS": .03, "AR": .03, "LA": .07},
    "midwest": {"OH": .16, "IN": .10, "IL": .18, "MI": .13, "WI": .09, "IA": .05, "KS": .05, "MN": .08, "MO": .09, "NE": .03, "ND": .02, "SD": .02},
    "southwest": {"TX": .58, "OK": .12, "NM": .07, "AZ": .18, "NV": .05},
    "west": {"CA": .58, "OR": .07, "WA": .12, "ID": .03, "MT": .025, "WY": .015, "CO": .09, "UT": .06, "AK": .015, "HI": .015},
}
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
    for slug, sugar, flavor, pack, func in rows:
        SKUS.append((f"{brand}_{slug}", brand, sugar, flavor, pack, func))
_mk("celsius",  [("peach_vibe_12oz","zero","fruit","single","energy_fitness"),("variety_12pk","zero","fruit","multipack","energy_fitness"),
                 ("cola_12oz","zero","classic","single","energy_fitness"),("arctic_vibe_12oz","zero","dessert","single","energy_fitness"),
                 ("essentials_watermelon_16oz","zero","fruit","single","energy_hydration")])
_mk("alani_nu", [("hawaiian_shaved_ice_12oz","zero","fruit","single","energy"),("cosmic_stardust_12oz","zero","dessert","single","energy"),
                 ("variety_12pk","zero","fruit","multipack","energy"),("cherry_slush_12oz","zero","fruit","single","energy_focus")])
_mk("monster",  [("original_16oz","full","classic","single","energy"),("ultra_white_16oz","zero","classic","single","energy"),
                 ("mango_loco_16oz","full","fruit","single","energy"),("ultra_strawberry_16oz","zero","fruit","single","energy"),
                 ("original_12pk","full","classic","multipack","energy"),("ultra_12pk","zero","classic","multipack","energy")])
_mk("red_bull", [("original_12oz","full","classic","single","energy"),("sugarfree_12oz","zero","classic","single","energy"),
                 ("summer_edition_12oz","full","fruit","single","energy"),("original_12pk","full","classic","multipack","energy")])
_mk("ghost",    [("sour_patch_16oz","zero","dessert","single","energy_focus"),("warheads_16oz","zero","fruit","single","energy_focus"),
                 ("variety_12pk","zero","fruit","multipack","energy_focus")])
_mk("c4",       [("frozen_bombsicle_16oz","zero","fruit","single","energy_fitness"),("original_16oz","zero","classic","single","energy_fitness"),
                 ("variety_12pk","zero","fruit","multipack","energy_fitness")])
_mk("other",    [("legacy_original_16oz","full","classic","single","energy"),("zero_fruit_12oz","zero","fruit","single","energy"),
                 ("fruit_16oz","full","fruit","single","energy")])
SKU_BY_BRAND = {b: [s for s in SKUS if s[1] == b] for b in BRANDS}
SKU_INDEX = {s[0]: s for s in SKUS}


@dataclass
class Buyer:
    id: str
    region: str
    state: str
    tier: str            # light / medium / heavy
    rate_per_week: float
    primary: str
    secondary: str | None
    occasion: str        # workout / daily / social
    channel_pref: list[str]
    reachable: bool
    consented_badge: bool
    price_sensitivity: float
    promo_sensitivity: float
    loyalty: float
    variety_seeking: float
    zero_preference: float
    fruit_preference: float
    fitness_affinity: float


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
    total = sum(max(0.0, value) for value in weights.values())
    r = rng.random() * total
    acc = 0.0
    for k, w in weights.items():
        acc += max(0.0, w)
        if r < acc:
            return k
    return k


def make_buyers(rng: random.Random) -> list[Buyer]:
    buyers = []
    for i in range(N_BUYERS):
        region = _pick(rng, REGIONS)
        state = _pick(rng, STATE_WEIGHTS[region])
        tier = _pick(rng, {"light": .49, "medium": .35, "heavy": .16})
        annual_rate = {"light": 4.5, "medium": 13.0, "heavy": 31.0}[tier]
        rate = annual_rate / 52 * rng.lognormvariate(-.03, .26)
        occasion_weights = {"workout": .27, "daily": .55, "social": .18}
        if tier == "heavy":
            occasion_weights["daily"] += .12; occasion_weights["social"] -= .06
        occasion = _pick(rng, occasion_weights)
        fitness = min(1.0, max(0.0, rng.betavariate(2.0, 2.5) + (.24 if occasion == "workout" else -.08)))
        zero = min(1.0, max(0.0, rng.betavariate(2.8, 1.9) + (.12 if fitness > .65 else 0)))
        fruit = rng.betavariate(2.3, 2.0)
        price = rng.betavariate(2.2, 2.4)
        promo = min(1.0, max(0.0, .35 * price + .65 * rng.betavariate(2.0, 2.2)))
        loyalty = rng.betavariate(4.5, 1.8)
        variety = min(1.0, max(0.0, 1 - loyalty + rng.uniform(-.12, .18)))

        share = dict(BASE_SHARE)
        if occasion == "workout":
            share["celsius"] *= 1.75; share["c4"] *= 1.55; share["ghost"] *= 1.18
        elif occasion == "social":
            share["red_bull"] *= 1.45; share["monster"] *= 1.22
        if zero > .65:
            for brand in ("celsius", "alani_nu", "ghost", "c4"):
                share[brand] *= 1.25
        if region == "southeast":
            share["celsius"] *= 1.10; share["alani_nu"] *= 1.18
        if region == "southwest":
            share["monster"] *= 1.12; share["c4"] *= 1.12
        primary = _pick(rng, share)
        secondary = None
        if rng.random() < .52:
            rest = {k: v for k, v in share.items() if k != primary}
            secondary = _pick(rng, rest)
        channel_scores = dict(CHANNELS)
        if tier == "heavy": channel_scores["convenience"] *= 1.35
        if price > .65: channel_scores["club"] *= 2.0; channel_scores["mass"] *= 1.4
        if occasion == "workout": channel_scores["online"] *= 1.35; channel_scores["grocery"] *= 1.15
        pref = sorted(channel_scores, key=lambda channel: -(channel_scores[channel] * rng.uniform(.75, 1.25)))[:3]
        reachable = rng.random() < .61
        buyers.append(Buyer(
            id=f"b{i:05d}", region=region, state=state, tier=tier, rate_per_week=rate, primary=primary,
            secondary=secondary, occasion=occasion, channel_pref=pref[:3],
            reachable=reachable, consented_badge=reachable and rng.random() < .56,
            price_sensitivity=price, promo_sensitivity=promo, loyalty=loyalty,
            variety_seeking=variety, zero_preference=zero, fruit_preference=fruit,
            fitness_affinity=fitness))
    return buyers


def _merchant_for(rng, channel, brand):
    cands = [m for m, (c, _) in MERCHANTS.items() if c == channel]
    w = {}
    for m in cands:
        w[m] = 1.0 + (1.6 if MERCHANTS[m][1] == brand else 0.0)
    return _pick(rng, w)


BRAND_ZERO = {"celsius": 1.0, "alani_nu": 1.0, "monster": .48, "red_bull": .26, "ghost": 1.0, "c4": 1.0, "other": .34}
BRAND_FRUIT = {"celsius": .72, "alani_nu": .82, "monster": .42, "red_bull": .30, "ghost": .62, "c4": .58, "other": .44}
BRAND_FITNESS = {"celsius": .92, "alani_nu": .54, "monster": .35, "red_bull": .38, "ghost": .66, "c4": .88, "other": .30}
EXPECTED_PRICE = {"celsius": 2.75, "alani_nu": 2.70, "monster": 3.15, "red_bull": 3.45, "ghost": 2.95, "c4": 2.85, "other": 2.45}


def _promotion_rate(brand: str, week: int, channel: str) -> float:
    base = .08 if channel in ("convenience", "online") else .14
    if brand == "ghost" and week == 37:
        return .68
    if brand == "alani_nu" and week >= 44 and channel in ("grocery", "mass"):
        return .24
    if brand == "red_bull" and 20 <= week <= 28:
        return .18
    return base


def _brand_utility(buyer: Buyer, brand: str, week: int, channel: str, recent_brand: str | None) -> float:
    utility = math.log(BASE_SHARE[brand])
    if brand == buyer.primary:
        utility += 1.35 + 1.25 * buyer.loyalty
    elif brand == buyer.secondary:
        utility += .58
    if brand == recent_brand:
        utility += .42 * (1 - buyer.variety_seeking)

    utility += .95 * (buyer.zero_preference - .5) * (BRAND_ZERO[brand] - .5)
    utility += .72 * (buyer.fruit_preference - .5) * (BRAND_FRUIT[brand] - .5)
    utility += .90 * (buyer.fitness_affinity - .5) * (BRAND_FITNESS[brand] - .5)
    utility -= .42 * buyer.price_sensitivity * (EXPECTED_PRICE[brand] - 2.75)
    utility += 1.65 * buyer.promo_sensitivity * _promotion_rate(brand, week, channel)

    if buyer.occasion == "workout":
        utility += {"celsius": .48, "c4": .36, "ghost": .16}.get(brand, 0)
    elif buyer.occasion == "social":
        utility += {"red_bull": .38, "monster": .28}.get(brand, 0)
    elif buyer.occasion == "daily":
        utility += {"alani_nu": .16, "monster": .12}.get(brand, 0)

    channel_fit = {
        "convenience": {"monster": .35, "red_bull": .32, "alani_nu": -.14},
        "grocery": {"alani_nu": .24, "celsius": .15},
        "mass": {"alani_nu": .15, "celsius": .11, "c4": .08},
        "club": {"monster": .24, "celsius": .16, "red_bull": .10},
        "online": {"ghost": .46, "c4": .32, "celsius": .12},
    }
    utility += channel_fit[channel].get(brand, 0)

    # Gradual innovation-driven adoption. It is strongest among non-workout Celsius
    # buyers in the Northeast, but remains probabilistic and competes with loyalty.
    adoption = max(0.0, min(1.0, (week - 34) / 17))
    if brand == "alani_nu":
        utility += .42 * adoption
        if buyer.primary == "celsius" and buyer.occasion != "workout":
            utility += (1.05 + .45 * buyer.variety_seeking) * adoption
        if buyer.region == "northeast":
            utility += .30 * adoption
    if brand == "celsius" and buyer.occasion == "workout":
        utility += .28 * adoption
    if brand in ("celsius", "alani_nu", "ghost", "c4"):
        utility += .20 * buyer.zero_preference * adoption
    return utility


def _brand_for(rng: random.Random, buyer: Buyer, week: int, channel: str, recent_brand: str | None) -> str:
    # Independent Gumbel shocks turn utilities into a multinomial-logit draw.
    scored = {}
    for brand in BRANDS:
        u = max(1e-12, min(1 - 1e-12, rng.random()))
        shock = -math.log(-math.log(u))
        scored[brand] = _brand_utility(buyer, brand, week, channel, recent_brand) + shock
    return max(scored, key=scored.get)


def _sku_for(rng, brand, buyer: Buyer, day: int):
    skus = SKU_BY_BRAND[brand]
    w = []
    week = day // 7
    for s in skus:
        _, _, sugar, flavor, pack, func = s
        x = 1.0
        x *= 1.0 + (buyer.zero_preference - .5) * (1.0 if sugar == "zero" else -1.0)
        x *= 1.0 + .75 * (buyer.fruit_preference - .5) * (1.0 if flavor == "fruit" else -.35)
        x *= 1.0 + .65 * (buyer.fitness_affinity - .5) * (1.0 if "fitness" in func else -.25)
        if pack == "multipack":
            x *= .28 if buyer.channel_pref[0] == "convenience" else 1.05 if buyer.channel_pref[0] in ("club", "online") else .72
        # Zero-sugar fruit diffuses gradually from the Southeast to the Northeast.
        if sugar == "zero" and flavor == "fruit":
            if buyer.region == "southeast" and week >= 28:
                x *= 1.0 + min(1.0, (week - 28) / 14) * .75
            if buyer.region == "northeast" and week >= 40:
                x *= 1.0 + min(1.0, (week - 40) / 10) * .95
            if buyer.tier != "light" and week >= 42:
                x *= 1.0 + min(1.0, (week - 42) / 8) * .35
        w.append(max(.02, x))
    return _pick(rng, {sku: weight for sku, weight in zip(skus, w)})


PACK_PRICE = {"single": 1.0, "multipack": 7.0}
CHANNEL_PRICE = {"convenience": 1.08, "grocery": .98, "mass": .95, "club": .89, "online": 1.01}


def _poisson(rng: random.Random, rate: float) -> int:
    limit = math.exp(-rate)
    product = 1.0
    count = 0
    while product > limit:
        count += 1
        product *= rng.random()
    return count - 1


def generate(seed: int = SEED) -> tuple[list[Buyer], list[Event]]:
    rng = random.Random(seed)
    buyers = make_buyers(rng)
    events: list[Event] = []
    for b in buyers:
        recent_brand = None
        first_late_alani_day = None
        for w in range(WEEKS):
            summer = 1.12 if 18 <= w <= 34 else .96
            new_year = 1.08 if w <= 5 and b.occasion == "workout" else 1.0
            rate = b.rate_per_week * summer * new_year * rng.lognormvariate(-.01, .08)
            days = sorted(w * 7 + rng.randint(0, 6) for _ in range(_poisson(rng, rate)))
            for day in days:
                channel = _pick(rng, {b.channel_pref[0]: .58, b.channel_pref[1]: .27, b.channel_pref[2]: .15})
                brand = _brand_for(rng, b, w, channel, recent_brand)
                if brand == "alani_nu" and b.primary == "celsius" and w >= 40:
                    if first_late_alani_day is None:
                        first_late_alani_day = day
                        if rng.random() < .55:
                            channel = "convenience"
                    elif day - first_late_alani_day <= 35 and rng.random() < .52:
                        channel = "grocery"
                promo = rng.random() < _promotion_rate(brand, w, channel)
                sku = _sku_for(rng, brand, b, day)
                merchant = _merchant_for(rng, channel, brand)
                if merchant == COVERAGE_GAP["merchant"] and w in COVERAGE_GAP["weeks"] \
                        and rng.random() > COVERAGE_GAP["retained"]:
                    continue
                pack = SKU_INDEX[sku[0]][4]
                regular = EXPECTED_PRICE[brand] * PACK_PRICE[pack] * CHANNEL_PRICE[channel] * rng.uniform(.96, 1.05)
                discount = rng.uniform(.14, .31) if promo else 0.0
                net = round(regular * (1 - discount), 2)
                missing_price = .08 if channel == "online" else .035
                if rng.random() < missing_price:
                    regular_out, promo_out = None, None
                else:
                    regular_out, promo_out = round(regular, 2), promo
                events.append(Event(
                    buyer=b.id, day=day, merchant=merchant, channel=channel, brand=brand,
                    sku=sku[0], qty=2 if pack == "single" and rng.random() < .07 else 1,
                    net=net, regular=regular_out, promo=promo_out, geo=b.region,
                    batch=f"batch_{w:02d}"))
                recent_brand = brand
    events.sort(key=lambda e: (e.day, e.buyer))
    return buyers, events


def day_to_date(day: int) -> date:
    return START + timedelta(days=day)
