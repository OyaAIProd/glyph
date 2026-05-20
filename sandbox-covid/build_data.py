"""Subset OWID covid-data to 15 countries × 2020-01-01..2023-05-05, derive
analytical datasets. All paths are relative to this script's parent (sandbox-covid/).

Output:
  derived/daily.csv               — daily per-country tidy frame, key columns only
  derived/country_totals.csv      — per-country cumulative totals + per-capita
  derived/weekly.csv              — 7-day aggregates per country
  derived/cfr_over_time.csv       — naive CFR (deaths_lag14 / cases) rolling
  derived/vax_milestones.csv      — date each country crossed 25/50/75% fully-vax
  derived/stringency_vs_outcome.csv — scatter source: stringency_mean × deaths_per_M
  derived/anomalies.csv           — z-score outliers on new_cases_smoothed
  derived/decompose_*.csv         — trend/seasonal/residual for 4 anchor countries
  derived/forecast_counterfactual.csv — "what if no vaccines" deaths trajectory
  derived/weekday_pattern.csv     — reporting cadence (mean new_cases by weekday)
"""
import csv, statistics, math, json
from collections import defaultdict, OrderedDict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent
DRV  = ROOT / "derived"
DRV.mkdir(exist_ok=True)

COUNTRIES = [
    "United States","United Kingdom","Germany","France","Italy","Sweden",
    "Israel","Japan","South Korea","Australia","Brazil","India",
    "South Africa","China","Mexico",
]
CONTINENT_FIX = {  # OWID continent column is already correct, but for our 15:
    "United States":"North America","Mexico":"North America",
    "Brazil":"South America",
    "United Kingdom":"Europe","Germany":"Europe","France":"Europe","Italy":"Europe","Sweden":"Europe",
    "Israel":"Asia","Japan":"Asia","South Korea":"Asia","China":"Asia","India":"Asia",
    "South Africa":"Africa",
    "Australia":"Oceania",
}
DATE_LO = "2020-01-01"
DATE_HI = "2023-05-05"

# Columns I care about (by name).
KEEP = [
    "iso_code","continent","location","date","population",
    "new_cases","new_cases_smoothed","total_cases","new_cases_per_million","new_cases_smoothed_per_million",
    "new_deaths","new_deaths_smoothed","total_deaths","new_deaths_per_million","new_deaths_smoothed_per_million",
    "total_cases_per_million","total_deaths_per_million",
    "reproduction_rate","icu_patients","icu_patients_per_million","hosp_patients","hosp_patients_per_million",
    "new_tests_smoothed_per_thousand","positive_rate",
    "people_fully_vaccinated_per_hundred","total_vaccinations_per_hundred","total_boosters_per_hundred",
    "stringency_index","gdp_per_capita","aged_65_older","life_expectancy","human_development_index",
]

# ---- 1) subset daily ------------------------------------------------------
src = ROOT / "data" / "owid-covid-data.csv"
hdr = open(src).readline().strip().split(",")
idx = {n:i for i,n in enumerate(hdr)}
keep_idx = [idx[c] for c in KEEP]

daily_rows = []
with open(src) as f:
    f.readline()  # header
    for line in f:
        row = line.rstrip("\n").split(",")
        loc = row[idx["location"]]
        if loc not in COUNTRIES: continue
        d = row[idx["date"]]
        if not (DATE_LO <= d <= DATE_HI): continue
        daily_rows.append([row[i] for i in keep_idx])

with (DRV/"daily.csv").open("w", newline="") as f:
    w = csv.writer(f); w.writerow(KEEP); w.writerows(daily_rows)
print(f"daily.csv: {len(daily_rows)} rows")

# Rebuild as dicts for downstream work
def num(s):
    try: return float(s) if s != "" else None
    except: return None
def parse(rows):
    out = []
    for r in rows:
        d = {KEEP[i]:r[i] for i in range(len(KEEP))}
        for k in d:
            if k not in ("iso_code","continent","location","date"):
                d[k] = num(d[k])
        out.append(d)
    return out
daily = parse(daily_rows)

# Group by country
by_c = defaultdict(list)
for r in daily: by_c[r["location"]].append(r)
for c in by_c: by_c[c].sort(key=lambda x: x["date"])

# ---- 2) country_totals ------------------------------------------------------
totals = []
for c, rows in by_c.items():
    last = rows[-1]
    # cumulative new_cases / new_deaths from this window (sum new_cases)
    tc = sum((r["new_cases"] or 0) for r in rows)
    td = sum((r["new_deaths"] or 0) for r in rows)
    pop = next((r["population"] for r in rows if r["population"]), None)
    # latest non-null per-capita and vax
    def latest(field):
        for r in reversed(rows):
            if r[field] is not None: return r[field]
        return None
    totals.append({
        "country": c,
        "continent": CONTINENT_FIX.get(c, last["continent"] or ""),
        "population_M": round((pop or 0)/1e6, 2),
        "total_cases": int(tc),
        "total_deaths": int(td),
        "cases_per_M": round(tc / (pop or 1) * 1e6, 1) if pop else None,
        "deaths_per_M": round(td / (pop or 1) * 1e6, 1) if pop else None,
        "vax_fully_pct": latest("people_fully_vaccinated_per_hundred"),
        "boosters_pct": latest("total_boosters_per_hundred"),
        "stringency_mean": round(statistics.mean([r["stringency_index"] for r in rows if r["stringency_index"] is not None]), 1) if any(r["stringency_index"] for r in rows) else None,
        "gdp_per_capita": latest("gdp_per_capita"),
        "aged_65_older": latest("aged_65_older"),
        "hdi": latest("human_development_index"),
        "life_expectancy": latest("life_expectancy"),
    })
totals.sort(key=lambda r: -(r["deaths_per_M"] or 0))
with (DRV/"country_totals.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(totals[0].keys())); w.writeheader(); w.writerows(totals)
print(f"country_totals.csv: {len(totals)} rows")

# ---- 3) weekly aggregates ---------------------------------------------------
# week_start = Monday before each date
def week_start(s):
    d = date.fromisoformat(s)
    return (d - timedelta(days=d.weekday())).isoformat()

weekly = defaultdict(lambda: {"new_cases":0,"new_deaths":0,"days":0})
for c, rows in by_c.items():
    for r in rows:
        ws = week_start(r["date"])
        k = (c, ws)
        weekly[k]["new_cases"] += r["new_cases"] or 0
        weekly[k]["new_deaths"] += r["new_deaths"] or 0
        weekly[k]["days"] += 1
        weekly[k]["continent"] = CONTINENT_FIX.get(c, "")
        weekly[k]["population"] = next((rr["population"] for rr in rows if rr["population"]), None)

weekly_rows = []
for (c, ws), v in weekly.items():
    pop = v["population"] or 1
    weekly_rows.append({
        "country": c, "continent": v["continent"], "week_start": ws,
        "new_cases": int(v["new_cases"]), "new_deaths": int(v["new_deaths"]),
        "new_cases_per_M": round(v["new_cases"]/pop*1e6, 2),
        "new_deaths_per_M": round(v["new_deaths"]/pop*1e6, 3),
    })
weekly_rows.sort(key=lambda r: (r["country"], r["week_start"]))
with (DRV/"weekly.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(weekly_rows[0].keys())); w.writeheader(); w.writerows(weekly_rows)
print(f"weekly.csv: {len(weekly_rows)} rows")

# ---- 4) CFR over time (case-fatality ratio with 14-day lag, monthly buckets) ---
def yyyymm(s): return s[:7]
def safe_div(a, b): return (a/b) if b > 0 else None

cfr_rows = []
for c, rows in by_c.items():
    by_month_cases = defaultdict(float)
    by_month_deaths = defaultdict(float)
    # cases by their reported month, deaths shifted back 14 days (so deaths from day d count toward month of d-14)
    for r in rows:
        ym = yyyymm(r["date"])
        by_month_cases[ym] += (r["new_cases"] or 0)
    for r in rows:
        d14 = (date.fromisoformat(r["date"]) - timedelta(days=14)).isoformat()
        ym = yyyymm(d14)
        by_month_deaths[ym] += (r["new_deaths"] or 0)
    pop = next((rr["population"] for rr in rows if rr["population"]), 1)
    for ym in sorted(set(by_month_cases) | set(by_month_deaths)):
        cases = by_month_cases.get(ym, 0)
        deaths = by_month_deaths.get(ym, 0)
        cfr = safe_div(deaths, cases)
        cfr_rows.append({
            "country": c, "continent": CONTINENT_FIX.get(c, ""),
            "month": ym + "-01",
            "cases_in_month": int(cases),
            "deaths_shifted_back14d": int(deaths),
            "cfr_pct": round(cfr*100, 3) if cfr is not None else None,
            "deaths_per_M": round(deaths/pop*1e6, 3),
        })
with (DRV/"cfr_over_time.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(cfr_rows[0].keys())); w.writeheader(); w.writerows(cfr_rows)
print(f"cfr_over_time.csv: {len(cfr_rows)} rows")

# ---- 5) vax milestones ------------------------------------------------------
vax_rows = []
for c, rows in by_c.items():
    found = {25:None, 50:None, 75:None}
    for r in rows:
        v = r["people_fully_vaccinated_per_hundred"]
        if v is None: continue
        for threshold in (25, 50, 75):
            if found[threshold] is None and v >= threshold:
                found[threshold] = r["date"]
    vax_rows.append({"country": c, "continent": CONTINENT_FIX.get(c,""), **{f"date_fullyvax_{t}pct": found[t] or "" for t in (25,50,75)}})
with (DRV/"vax_milestones.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(vax_rows[0].keys())); w.writeheader(); w.writerows(vax_rows)
print(f"vax_milestones.csv: {len(vax_rows)} rows")

# ---- 6) stringency_vs_outcome.csv -----------------------------------------
# Per country: mean stringency over the period × deaths_per_M (end of period)
# join with country_totals data
scatter_rows = []
for t in totals:
    scatter_rows.append({
        "country": t["country"], "continent": t["continent"],
        "stringency_mean": t["stringency_mean"],
        "deaths_per_M": t["deaths_per_M"],
        "vax_fully_pct": t["vax_fully_pct"],
        "gdp_per_capita": t["gdp_per_capita"],
        "aged_65_older": t["aged_65_older"],
    })
with (DRV/"stringency_vs_outcome.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(scatter_rows[0].keys())); w.writeheader(); w.writerows(scatter_rows)
print(f"stringency_vs_outcome.csv: {len(scatter_rows)} rows")

# ---- 7) anomalies: z-score on new_cases_smoothed within each country -------
anomaly_rows = []
for c, rows in by_c.items():
    vals = [r["new_cases_smoothed"] for r in rows if r["new_cases_smoothed"] is not None]
    if len(vals) < 30:
        continue
    mu = statistics.mean(vals); sd = statistics.pstdev(vals) or 1e-9
    for r in rows:
        v = r["new_cases_smoothed"]
        if v is None: continue
        z = (v - mu) / sd
        anomaly_rows.append({
            "country": c, "date": r["date"],
            "new_cases_smoothed": round(v, 1),
            "zscore": round(z, 3),
            "is_anomaly": "Y" if abs(z) > 2 else "",
        })
with (DRV/"anomalies.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(anomaly_rows[0].keys())); w.writeheader(); w.writerows(anomaly_rows)
print(f"anomalies.csv: {len(anomaly_rows)} rows")

# ---- 8) Decompose new_cases_smoothed for 4 anchor countries ----------------
#  trend = 14-day centered MA; seasonal = mean within day-of-week; residual = orig - trend - seasonal
DECOMP_COUNTRIES = ["United States","United Kingdom","India","South Korea"]
for c in DECOMP_COUNTRIES:
    rows = [r for r in by_c[c] if r["new_cases_smoothed"] is not None]
    if not rows: continue
    closes = [r["new_cases_smoothed"] for r in rows]
    n = len(closes)
    trend = []
    for i in range(n):
        lo = max(0, i-7); hi = min(n, i+8)
        trend.append(sum(closes[lo:hi]) / (hi-lo))
    detrended = [closes[i] - trend[i] for i in range(n)]
    dow_means = defaultdict(list)
    for i, r in enumerate(rows):
        dow = date.fromisoformat(r["date"]).weekday()
        dow_means[dow].append(detrended[i])
    seas_by_dow = {dow: statistics.mean(v) for dow, v in dow_means.items()}
    seasonal = []
    for r in rows:
        dow = date.fromisoformat(r["date"]).weekday()
        seasonal.append(seas_by_dow[dow])
    residual = [closes[i] - trend[i] - seasonal[i] for i in range(n)]
    out_rows = []
    for i, r in enumerate(rows):
        out_rows.append({
            "country": c, "date": r["date"],
            "actual": round(closes[i], 2),
            "trend": round(trend[i], 2),
            "seasonal": round(seasonal[i], 2),
            "residual": round(residual[i], 2),
        })
    fname = "decompose_" + c.replace(" ","_") + ".csv"
    with (DRV/fname).open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys())); w.writeheader(); w.writerows(out_rows)
    print(f"{fname}: {len(out_rows)} rows")

# ---- 9) Counterfactual: what if vaccines never landed? --------------------
# Approach: train monthly CFR(pre-vax) on each country up to (vax 25% date),
# then assume CFR stays at that level + actual cases continue.
# Compute counterfactual cumulative deaths under that CFR vs actual.
cf_rows = []
for c, rows in by_c.items():
    vax_25 = next((v[f"date_fullyvax_{25}pct"] for v in vax_rows if v["country"]==c), "")
    if not vax_25:
        # Country never reached 25% — skip
        continue
    pre_vax_cases = sum((r["new_cases"] or 0) for r in rows if r["date"] < vax_25)
    pre_vax_deaths = sum((r["new_deaths"] or 0) for r in rows if r["date"] < vax_25)
    if pre_vax_cases < 1000:
        continue
    cfr_pre = pre_vax_deaths / pre_vax_cases  # naive country-specific pre-vax CFR
    post_vax_cases = sum((r["new_cases"] or 0) for r in rows if r["date"] >= vax_25)
    post_vax_deaths_actual = sum((r["new_deaths"] or 0) for r in rows if r["date"] >= vax_25)
    counterfactual_deaths = post_vax_cases * cfr_pre  # if CFR stayed at pre-vax level
    lives_saved = counterfactual_deaths - post_vax_deaths_actual
    cf_rows.append({
        "country": c,
        "continent": CONTINENT_FIX.get(c, ""),
        "date_25pct_fully_vax": vax_25,
        "pre_vax_cfr_pct": round(cfr_pre*100, 3),
        "pre_vax_cases": int(pre_vax_cases),
        "pre_vax_deaths": int(pre_vax_deaths),
        "post_vax_cases": int(post_vax_cases),
        "post_vax_deaths_actual": int(post_vax_deaths_actual),
        "post_vax_deaths_counterfactual": int(counterfactual_deaths),
        "estimated_lives_saved": int(lives_saved),
        "lives_saved_per_M": round(lives_saved / (totals[0]["population_M"]*1e6 if False else next(t["population_M"] for t in totals if t["country"]==c)*1e6) * 1e6, 1),
    })
cf_rows.sort(key=lambda r: -r["estimated_lives_saved"])
with (DRV/"forecast_counterfactual.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(cf_rows[0].keys())); w.writeheader(); w.writerows(cf_rows)
print(f"forecast_counterfactual.csv: {len(cf_rows)} rows")

# ---- 10) Weekday reporting pattern -----------------------------------------
wd_rows = []
DOW_NAME = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
for c, rows in by_c.items():
    by_dow = defaultdict(list)
    for r in rows:
        if r["new_cases"] is None: continue
        # ratio of raw to smoothed — captures reporting cadence cleanly
        sm = r["new_cases_smoothed"]
        if not sm or sm < 1: continue
        ratio = r["new_cases"] / sm
        dow = date.fromisoformat(r["date"]).weekday()
        by_dow[dow].append(ratio)
    for dow in range(7):
        v = by_dow[dow]
        if not v: continue
        wd_rows.append({
            "country": c,
            "weekday": DOW_NAME[dow],
            "dow_num": dow,
            "mean_raw_to_smoothed_ratio": round(statistics.mean(v), 3),
            "n_days": len(v),
        })
with (DRV/"weekday_pattern.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(wd_rows[0].keys())); w.writeheader(); w.writerows(wd_rows)
print(f"weekday_pattern.csv: {len(wd_rows)} rows")

print("\nDone. All artifacts under derived/.")
