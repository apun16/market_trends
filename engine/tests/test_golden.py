import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from pogo_trends.stats import betainc, beta_binomial_interval, mad, first_persistent_crossing
from pogo_trends.build import run

def test_betainc_known_values():
    assert abs(betainc(2, 3, 0.4) - 0.5248) < 1e-4
    ci = beta_binomial_interval(11, 20)
    assert 0.35 < ci["low"] < ci["point"] < ci["high"] < 0.75

def test_mad_and_crossing():
    assert abs(mad([1, 2, 3, 4, 100]) - 1.4826) < 1e-9
    assert first_persistent_crossing([0, 0, 5, 5, 0, 5, 5, 5], 1, 3) == 5

def test_dataset_integrity(tmp_path):
    g = run(tmp_path)
    industry = json.loads((tmp_path / "industry.json").read_text())
    buyers = json.loads((tmp_path / "buyers.json").read_text())
    quality = industry["quality"]

    assert quality["buyers"] == 25_000
    assert len(buyers["rows"]) == 25_000
    assert 275_000 <= quality["events"] <= 325_000
    assert quality["active_buyers"] >= 24_500
    assert quality["coverage"]["states"] == 50
    assert quality["coverage"]["smallest_state_panel"] >= buyers["min_cell"]
    assert quality["unique_skus"] >= 25
    assert quality["regular_price_completeness"] >= .95
    assert quality["promotion_flag_completeness"] >= .95
    assert 6 <= quality["events_per_buyer"]["p50"] <= 12
    assert quality["events_per_buyer"]["p99"] <= 60

    assert g["switch_velocity"] >= 1.5
    assert g["switchers"] >= 75
    assert g["states"]["sig_switch_celsius_alani"] in {"emerging", "qualified"}
    assert g["states"]["sig_celsius_workout_retention"] == "qualified"
    assert g["states"]["sig_zero_fruit_northeast"] == "qualified"
    assert g["states"]["sig_ghost_promo_spike"] == "tracking"
    assert g["states"]["sig_share_monster"] == "suppressed"
    assert g["flagged_merchants"] == ["m_quickstop"]
    assert 14 <= g["observed_lead_days"] <= 28
    assert g["promo_trial_claim"][1] == 20
    assert g["taste_claim"][1] == 20
    assert (tmp_path / "signals.json").exists()

if __name__ == "__main__":
    import tempfile
    test_betainc_known_values(); test_mad_and_crossing()
    test_dataset_integrity(pathlib.Path(tempfile.mkdtemp()))
    print("all golden tests passed")
