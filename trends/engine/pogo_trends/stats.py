"""Interpretable statistics used by every detector. No numpy/scipy required."""
from __future__ import annotations
import math
from statistics import median


def mad(values: list[float]) -> float:
    """Median absolute deviation, scaled to be consistent with sigma for normal data."""
    if not values:
        return 0.0
    m = median(values)
    return 1.4826 * median([abs(v - m) for v in values])


def robust_z(x: float, baseline: list[float]) -> float:
    """(x - median) / MAD. Falls back to a small floor so flat baselines don't explode."""
    if not baseline:
        return 0.0
    m = median(baseline)
    s = mad(baseline)
    floor = max(0.05 * abs(m), 1e-9)
    return (x - m) / max(s, floor)


# --- Regularized incomplete beta (Numerical Recipes continued fraction) ---------

def _betacf(a: float, b: float, x: float) -> float:
    MAXIT, EPS, FPMIN = 300, 3e-14, 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > FPMIN else FPMIN)
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > FPMIN else FPMIN)
        c = 1.0 + aa / (c if abs(c) > FPMIN else FPMIN)
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > FPMIN else FPMIN)
        c = 1.0 + aa / (c if abs(c) > FPMIN else FPMIN)
        de = d * c
        h *= de
        if abs(de - 1.0) < EPS:
            break
    return h


def betainc(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    bt = math.exp(lbeta + a * math.log(x) + b * math.log(1 - x))
    if x < (a + 1) / (a + b + 2):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1 - x) / b


def beta_ppf(q: float, a: float, b: float) -> float:
    """Quantile of Beta(a, b) by bisection on the CDF."""
    lo, hi = 0.0, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if betainc(a, b, mid) < q:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def beta_binomial_interval(k: int, n: int, level: float = 0.9,
                           prior: tuple[float, float] = (0.5, 0.5)) -> dict:
    """Posterior credible interval for a proportion under a Beta prior (Jeffreys by default)."""
    a = prior[0] + k
    b = prior[1] + max(n - k, 0)
    tail = (1 - level) / 2
    return {
        "point": k / n if n else 0.0,
        "mean": a / (a + b),
        "low": beta_ppf(tail, a, b),
        "high": beta_ppf(1 - tail, a, b),
        "level": level,
        "prior": "jeffreys",
    }


def prob_ratio_exceeds(k1: int, n1: int, k0: int, n0: int, ratio: float,
                       draws: int = 2000, seed: int = 7) -> float:
    """P(p1 / p0 > ratio) via inverse-CDF sampling of the two posteriors (deterministic)."""
    import random
    rng = random.Random(seed)
    a1, b1 = 0.5 + k1, 0.5 + n1 - k1
    a0, b0 = 0.5 + k0, 0.5 + n0 - k0
    hits = 0
    for _ in range(draws):
        p1 = beta_ppf(rng.random(), a1, b1)
        p0 = beta_ppf(rng.random(), a0, b0)
        if p0 > 0 and p1 / p0 > ratio:
            hits += 1
    return hits / draws


def cross_correlation(x: list[float], y: list[float], max_lag: int) -> list[dict]:
    """Bounded lagged Pearson correlation. Positive lag means y follows x by `lag` steps."""
    def corr(a, b):
        n = len(a)
        if n < 3:
            return 0.0
        ma, mb = sum(a) / n, sum(b) / n
        num = sum((p - ma) * (q - mb) for p, q in zip(a, b))
        da = math.sqrt(sum((p - ma) ** 2 for p in a))
        db = math.sqrt(sum((q - mb) ** 2 for q in b))
        return num / (da * db) if da and db else 0.0
    out = []
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            a, b = x[: len(x) - lag], y[lag:]
        else:
            a, b = x[-lag:], y[: len(y) + lag]
        out.append({"lag": lag, "r": round(corr(a, b), 4)})
    return out


def first_persistent_crossing(series: list[float], threshold: float, persist: int) -> int | None:
    """Index of the first point that starts a run of `persist` consecutive values above threshold."""
    run = 0
    for i, v in enumerate(series):
        run = run + 1 if v > threshold else 0
        if run >= persist:
            return i - persist + 1
    return None


def survival_curve(times: list[int | None], horizon: int) -> list[dict]:
    """Fraction of a cohort that has 'converted' (e.g. repeated) by day d. None = never within horizon."""
    n = len(times)
    out = []
    for d in range(0, horizon + 1, 7):
        c = sum(1 for t in times if t is not None and t <= d)
        out.append({"day": d, "converted": round(c / n, 4) if n else 0.0, "n": n})
    return out
