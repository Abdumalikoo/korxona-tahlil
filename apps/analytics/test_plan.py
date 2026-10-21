"""Hudud uchun reja — statistik dvigatel testlari (sun'iy, aniq test ma'lumotlari).

Ishga tushirish:  .venv\\Scripts\\python -m unittest test_plan -v
"""

import copy
import json
import math
import unittest

import numpy as np

from app.plan import models as M
from app.plan.allocate import allocate_region
from app.plan.engine import TariffBook, analyze_series, backtest, compute, largest_remainder, metrics, months_between

NAN = float("nan")


class ModelsTest(unittest.TestCase):
    def test_naive_ma3_snaive(self):
        y = np.arange(1, 16, dtype=float)  # 1..15
        self.assertEqual(M.naive(y).forecast, 15)
        self.assertAlmostEqual(M.ma3(y).forecast, (13 + 14 + 15) / 3)
        # 16-oy prognozi = 16−12 = 4-oy qiymati (indeks 3)
        self.assertEqual(M.snaive(y).forecast, 4)
        self.assertIsNone(M.ma3(np.array([1.0, 2.0])))
        self.assertIsNone(M.ma3(np.array([1.0, NAN, 2.0, 3.0])[:3]))
        self.assertIsNone(M.snaive(np.arange(11, dtype=float)))
        self.assertIsNone(M.naive(np.array([1.0, NAN])))

    def test_ses_manual(self):
        y = np.array([10.0, 12.0, 11.0, 13.0, 12.0])
        level = y[0]
        for v in y[1:]:
            level = 0.3 * v + 0.7 * level
        self.assertAlmostEqual(M.ses(y, alpha=0.3).forecast, level)
        # Grid: tanlangan alpha SSE bo'yicha eng yaxshisi
        best = M.ses(y)
        sse = lambda a: sum((y[t] - (lambda l: l)(self._ses_level(y[:t], a))) ** 2 for t in range(1, len(y)))
        self.assertLessEqual(sse(best.params["alpha"]), min(sse(a) for a in M.ALPHAS) + 1e-9)

    @staticmethod
    def _ses_level(y, a):
        level = y[0]
        for v in y[1:]:
            level = a * v + (1 - a) * level
        return level

    def test_ses_holt_hw_match_statsmodels(self):
        try:
            from statsmodels.tsa.holtwinters import ExponentialSmoothing, Holt, SimpleExpSmoothing
        except ImportError:  # pragma: no cover
            self.skipTest("statsmodels o'rnatilmagan")
        rng = np.random.default_rng(7)
        y = 100 + np.arange(30) * 2.0 + 10 * np.sin(np.arange(30) * 2 * math.pi / 12) + rng.normal(0, 2, 30)
        sm = SimpleExpSmoothing(y, initialization_method="known", initial_level=y[0]).fit(smoothing_level=0.4, optimized=False)
        self.assertAlmostEqual(M.ses(y, alpha=0.4).forecast, float(sm.forecast(1)[0]), places=6)
        # bizning holat birinchi kuzatuvdan keyingi (l=y0, b=y1−y0) — statsmodels boshlanishi undan bir qadam oldin
        sm = Holt(y, initialization_method="known", initial_level=2 * y[0] - y[1], initial_trend=y[1] - y[0]).fit(smoothing_level=0.3, smoothing_trend=0.1, optimized=False)
        self.assertAlmostEqual(M.holt(y, alpha=0.3, beta=0.1).forecast, float(sm.forecast(1)[0]), places=6)
        # Holt-Winters: statsmodels «known» boshlanishi bizning ta'rif bilan (birinchi 12 oy bo'yicha)
        first, second = y[:12], y[12:24]
        lvl = first.mean()
        trd = (second.mean() - first.mean()) / 12
        seas = first - first.mean()
        # bizda rekursiya 12-oydan boshlanadi: statsmodels'ga 12-oydan keyingi qatorni beramiz
        sm = ExponentialSmoothing(y[12:], trend="add", seasonal="add", seasonal_periods=12, initialization_method="known", initial_level=lvl, initial_trend=trd, initial_seasonal=seas).fit(
            smoothing_level=0.2, smoothing_trend=0.02, smoothing_seasonal=0.15, optimized=False
        )
        ours = M.hw(y, alpha=0.2, beta=0.02, gamma=0.15).forecast
        # statsmodels boshlang'ich darajani bir qadam oldingi holat deb oladi — trend qo'shimchasi farq qiladi
        self.assertLess(abs(ours - float(sm.forecast(1)[0])) / abs(ours), 0.05)

    def test_croston_sba(self):
        y = np.array([0, 0, 5, 0, 0, 0, 4, 0, 6, 0, 0, 3], dtype=float)
        self.assertTrue(M.is_intermittent(y))
        c = M.croston(y, alpha=0.1)
        s = M.sba(y, alpha=0.1)
        # qo'lda: z, p yangilanishi
        z, p, q = 5.0, 3.0, 1.0
        for v in y[3:]:
            if v > 0:
                z += 0.1 * (v - z)
                p += 0.1 * (q - p)
                q = 1.0
            else:
                q += 1
        self.assertAlmostEqual(c.forecast, z / p)
        self.assertAlmostEqual(s.forecast, z / p * 0.95)
        self.assertIsNone(M.croston(np.arange(1, 13, dtype=float)))
        self.assertNotIn("holt", M.candidates(y))

    def test_missing_not_zero(self):
        y = np.array([5, 6, NAN, 7, 8, 9, 10, 11], dtype=float)
        # SES faqat oxirgi uzluksiz bo'lakda (7..11) o'qitiladi
        self.assertAlmostEqual(M.ses(y, alpha=1.0).forecast, 11)
        res = analyze_series(np.array([NAN, NAN, NAN]), 6)
        self.assertIsNone(res["forecast"])
        self.assertEqual(res["reliability"], "none")


class BacktestTest(unittest.TestCase):
    def test_no_leakage(self):
        rng = np.random.default_rng(3)
        y = rng.uniform(50, 100, 30)
        p1 = backtest(y, 6)
        y2 = y.copy()
        y2[27:] = 1e6  # kelajakdagi qiymatlar o'zgarsa, oldingi test nuqtalari o'zgarmasligi kerak
        p2 = backtest(y2, 6)
        for name in p1:
            for k in (24, 25, 26, 27):
                if k in p1[name]:
                    self.assertAlmostEqual(p1[name][k], p2[name][k], msg=f"{name} k={k}")

    def test_metrics_reference(self):
        a = np.array([10.0, 20.0, 30.0])
        f = np.array([12.0, 18.0, 33.0])
        m = metrics(a, f)
        self.assertAlmostEqual(m["mae"], 7 / 3)
        self.assertAlmostEqual(m["rmse"], math.sqrt((4 + 4 + 9) / 3))
        self.assertAlmostEqual(m["wape"], 7 / 60 * 100)
        z = metrics(np.zeros(3), np.array([1.0, 0.0, 2.0]))
        self.assertIsNone(z["wape"])  # nolga bo'linmaydi

    def test_selection_prefers_simpler(self):
        y = np.full(24, 40.0)
        res = analyze_series(y, 6)
        self.assertEqual(res["model"], "naive")  # hamma model aniq 40 — eng sodda tanlanadi
        self.assertEqual(res["wape"], 0)

    def test_trend_picks_trend_model(self):
        y = 10 + 3.0 * np.arange(24)
        res = analyze_series(y, 6)
        self.assertEqual(res["model"], "holt")
        self.assertAlmostEqual(res["forecast"], 10 + 3 * 24, places=4)

    def test_seasonal(self):
        base = np.array([10, 12, 30, 40, 22, 15, 11, 9, 13, 25, 35, 18], dtype=float)
        y = np.concatenate([base, base, base])
        res = analyze_series(y, 6)
        self.assertIn(res["model"], ("snaive", "hw"))
        self.assertAlmostEqual(res["forecast"], base[0], places=3)

    def test_insufficient_history(self):
        res = analyze_series(np.array([5.0, 7.0]), 6)
        self.assertEqual(res["reliability"], "none")
        self.assertEqual(res["model"], "naive")
        self.assertIn("yetarli emas", res["reason"])

    def test_largest_remainder(self):
        parts = largest_remainder(100, [1, 1, 1])
        self.assertEqual(sum(parts), 100)
        self.assertEqual(sorted(parts), [33, 33, 34])
        self.assertEqual(largest_remainder(0, [1, 2]), [0, 0])


def sample_body():
    months = months_between("2024-01", "2025-12")
    rng = np.random.default_rng(11)
    series = []
    for region in (3, 26):
        for i, svc in enumerate(["SRV_01", "SRV_02", "SRV_03"]):
            base = 50 + 20 * i + region
            qty = [float(max(0, round(base + 0.8 * t + rng.normal(0, 4)))) for t in range(len(months))]
            if svc == "SRV_03" and region == 3:
                qty = [float(v if t % 3 == 0 else 0) for t, v in enumerate(qty)]  # uzlukli
            rev = [q * (20000 + 5000 * i) for q in qty]
            series.append({"region": region, "service": svc, "qty": qty, "rev": rev})
    series.append({"region": 26, "service": "SRV_04", "qty": [None] * len(months), "rev": [None] * len(months)})
    tariffs = [{"service": f"SRV_0{i + 1}", "region": None, "validFrom": "2020-01-01", "price": 20000 + 5000 * i} for i in range(3)]
    emp = {
        "3": {
            "employees": [
                {"pinfl": "A", "name": "Ali", "position": "Inspektor", "active": True},
                {"pinfl": "B", "name": "Vali", "position": "Inspektor", "active": True},
                {"pinfl": "C", "name": "Yangi", "position": "Inspektor", "active": True, "hiredAt": "2025-12-15"},
                {"pinfl": "D", "name": "Ketgan", "position": "Inspektor", "active": False, "firedAt": "2025-11-30"},
            ],
            "empMonths": [{"pinfl": p, "period": m, "workedDays": d} for m in months[-6:] for p, d in (("A", 22), ("B", 11), ("D", 20))]
            + [{"pinfl": "C", "period": "2026-01", "workedDays": 20}],
            "empServices": [{"pinfl": p, "period": m, "service": s, "revenue": r, "qty": 1} for m in months[-6:] for p, s, r in (("A", "SRV_01", 600), ("B", "SRV_01", 300), ("A", "SRV_02", 100), ("D", "SRV_01", 999))],
            "workDays": {},
        }
    }
    return {
        "targetPeriod": "2026-01",
        "months": months,
        "series": series,
        "tariffs": tariffs,
        "services": [{"code": f"SRV_0{i}", "name": f"Xizmat {i}"} for i in range(1, 5)],
        "regions": [{"code": 3, "name": "Andijon"}, {"code": 26, "name": "Toshkent shahri"}],
        "options": {"backtestMonths": 6, "selection": "auto", "roundQuantity": True},
        "allocation": {"method": "perday", "window": 6, "newEmployees": True, "regions": emp},
    }


class ComputeTest(unittest.TestCase):
    def test_sums_and_determinism(self):
        body = sample_body()
        r1 = compute(copy.deepcopy(body))
        r2 = compute(copy.deepcopy(body))
        self.assertEqual(json.dumps(r1, sort_keys=True, default=str), json.dumps(r2, sort_keys=True, default=str))
        total = 0
        for reg in r1["regions"]:
            svc_sum = sum(x["forecastRev"] or 0 for x in reg["services"])
            self.assertEqual(reg["forecastRev"], svc_sum)
            for x in reg["services"]:
                if x["forecastRev"] is not None:
                    self.assertEqual(x["forecastRev"], round(x["forecastQtyFinal"] * x["tariff"]))
                    self.assertEqual(x["forecastQtyFinal"], round(x["forecastQty"]))
            total += reg["forecastRev"]
        self.assertEqual(r1["total"]["forecastRev"], total)
        t26 = next(r for r in r1["regions"] if r["region"] == 26)
        self.assertIn("SRV_04", t26["servicesNoData"])
        intermittent = next(x for x in r1["regions"][0]["services"] if x["service"] == "SRV_03")
        self.assertTrue(intermittent["intermittent"])
        self.assertNotIn(intermittent["model"], ("holt", "hw"))

    def test_allocation(self):
        r = compute(sample_body())
        reg = next(x for x in r["regions"] if x["region"] == 3)
        emp = reg["employees"]
        self.assertEqual(emp["check"]["diff"], 0)
        plans = {e["pinfl"]: e for e in emp["employees"]}
        self.assertNotIn("D", plans)  # ishdan ketgan — kiritilmaydi
        s1 = next(x for x in reg["services"] if x["service"] == "SRV_01")["forecastRev"]
        a1 = next(v["plan"] for v in plans["A"]["services"] if v["service"] == "SRV_01")
        b1 = next(v["plan"] for v in plans["B"]["services"] if v["service"] == "SRV_01")
        c1 = next(v["plan"] for v in plans["C"]["services"] if v["service"] == "SRV_01")
        self.assertEqual(a1 + b1 + c1, s1)
        # bir kunlik: A 600×6/132 , B 300×6/66 — teng; A rejalashtirilgan 22 kun, B 11 kun → A = 2B
        self.assertLessEqual(abs(a1 - 2 * b1), 2)
        self.assertTrue(plans["C"]["isNew"])
        self.assertEqual(plans["C"]["plannedDays"], 20)
        # SRV_03 ni hech kim ko'rsatmagan → taqsimlanmagan
        s3 = next(x for x in reg["services"] if x["service"] == "SRV_03")["forecastRev"]
        if s3:
            self.assertTrue(any(u["service"] == "SRV_03" and u["amount"] == s3 for u in emp["unallocated"]))
        self.assertEqual(sum(e["plan"] for e in emp["employees"]) + emp["unallocatedTotal"], reg["forecastRev"])

    def test_share_method_and_window(self):
        body = sample_body()
        body["allocation"]["method"] = "share"
        body["allocation"]["newEmployees"] = False
        r = compute(body)
        emp = next(x for x in r["regions"] if x["region"] == 3)["employees"]
        plans = {e["pinfl"]: e for e in emp["employees"]}
        self.assertEqual(plans["C"]["plan"], 0)
        self.assertTrue(plans["C"]["manualNeeded"])
        a1 = next(v["plan"] for v in plans["A"]["services"] if v["service"] == "SRV_01")
        b1 = next(v["plan"] for v in plans["B"]["services"] if v["service"] == "SRV_01")
        self.assertLessEqual(abs(a1 - 2 * b1), 1)  # 600 : 300

    def test_target_validation(self):
        body = sample_body()
        body["targetPeriod"] = "2026-03"
        with self.assertRaises(ValueError):
            compute(body)

    def test_tariff_book(self):
        book = TariffBook([
            {"service": "S", "region": None, "validFrom": "2025-01-01", "price": 100},
            {"service": "S", "region": None, "validFrom": "2025-06-01", "price": 120},
            {"service": "S", "region": 3, "validFrom": "2025-03-01", "price": 90},
        ])
        self.assertEqual(book.at("S", 26, "2025-05"), 100)
        self.assertEqual(book.at("S", 26, "2025-06"), 120)
        self.assertEqual(book.at("S", 3, "2025-07"), 90)  # hududga xos tarif ustun
        self.assertIsNone(book.at("S", 26, "2024-12"))


if __name__ == "__main__":
    unittest.main()