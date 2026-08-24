"""Cheap in-memory aggregates over the event list. Everything downstream reads these."""
from __future__ import annotations
from collections import defaultdict
from .synth import Buyer, Event, WEEKS, BRANDS, SKU_INDEX


class Panel:
    def __init__(self, buyers: list[Buyer], events: list[Event]):
        self.buyers = buyers
        self.by_id = {b.id: b for b in buyers}
        self.events = events
        self.weeks = WEEKS
        # weekly distinct buyers and events per key
        self.brand_week_buyers = defaultdict(lambda: [set() for _ in range(WEEKS)])
        self.brand_week_events = defaultdict(lambda: [0] * WEEKS)
        self.brand_week_promo = defaultdict(lambda: [0] * WEEKS)      # promo-flagged events
        self.brand_week_known = defaultdict(lambda: [0] * WEEKS)      # events with known promo flag
        self.attr_week_events = defaultdict(lambda: [0] * WEEKS)      # (sugar, flavor)
        self.attr_region_week_events = defaultdict(lambda: [0] * WEEKS)
        self.region_week_events = defaultdict(lambda: [0] * WEEKS)
        self.channel_week_events = defaultdict(lambda: [0] * WEEKS)
        self.brand_channel_week_events = defaultdict(lambda: [0] * WEEKS)
        self.merchant_week_events = defaultdict(lambda: [0] * WEEKS)
        self.brand_merchant_events = defaultdict(int)
        self.cat_week_buyers = [set() for _ in range(WEEKS)]
        self.cat_week_events = [0] * WEEKS
        self.tier_attr_week = defaultdict(lambda: [0] * WEEKS)         # (tier, sugar, flavor)
        self.tier_week_events = defaultdict(lambda: [0] * WEEKS)
        self.buyer_events: dict[str, list[Event]] = defaultdict(list)
        for e in events:
            w = e.week
            s = SKU_INDEX[e.sku]
            attr = (s[2], s[3])
            b = self.by_id[e.buyer]
            self.brand_week_buyers[e.brand][w].add(e.buyer)
            self.brand_week_events[e.brand][w] += 1
            if e.promo is not None:
                self.brand_week_known[e.brand][w] += 1
                if e.promo:
                    self.brand_week_promo[e.brand][w] += 1
            self.attr_week_events[attr][w] += 1
            self.attr_region_week_events[(attr, e.geo)][w] += 1
            self.region_week_events[e.geo][w] += 1
            self.channel_week_events[e.channel][w] += 1
            self.brand_channel_week_events[(e.brand, e.channel)][w] += 1
            self.merchant_week_events[e.merchant][w] += 1
            self.brand_merchant_events[(e.brand, e.merchant)] += 1
            self.cat_week_buyers[w].add(e.buyer)
            self.cat_week_events[w] += 1
            self.tier_attr_week[(b.tier, attr[0], attr[1])][w] += 1
            self.tier_week_events[b.tier][w] += 1
            self.buyer_events[e.buyer].append(e)

    # -- helpers -----------------------------------------------------------
    def brand_buyers_in(self, brand: str, w0: int, w1: int) -> set[str]:
        s = set()
        for w in range(w0, w1 + 1):
            s |= self.brand_week_buyers[brand][w]
        return s

    def cat_buyers_in(self, w0: int, w1: int) -> set[str]:
        s = set()
        for w in range(w0, w1 + 1):
            s |= self.cat_week_buyers[w]
        return s

    def buyer_brand_counts(self, buyer: str, w0: int, w1: int) -> dict[str, int]:
        out = defaultdict(int)
        for e in self.buyer_events[buyer]:
            if w0 <= e.week <= w1:
                out[e.brand] += 1
        return out
