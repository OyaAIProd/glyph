"""Construct 10 Glyph spec JSON files for the COVID showcase. Uses absolute
paths in SQL transforms (DuckDB doesn't resolve relative to spec dir).
Casts DATE→VARCHAR everywhere to dodge the {days:N}/Number()→NaN issue
encountered earlier.
"""
import json
from pathlib import Path

ROOT = Path(__file__).parent
A = str(ROOT.resolve())   # absolute sandbox-covid path
SPECS = ROOT / "specs"
SPECS.mkdir(exist_ok=True)

# --- load GeoJSON inline; subset to FEATURES we need + map other countries to grey ---
geo = json.load(open(ROOT/"data"/"world.geojson"))
COUNTRIES_GJ = {"USA","England","Germany","France","Italy","Sweden","Israel","Japan",
                "South Korea","Australia","Brazil","India","South Africa","China","Mexico"}
# Keep ALL features so the world map shows context; data join lights up our 15.
GEO_FEATURES = geo["features"]

def write(name, spec):
    p = SPECS / name
    json.dump(spec, open(p,"w"), indent=2)
    print(f"wrote {p.name}")

# ===========================================================
# 1) Global geo map — cumulative deaths per million
# ===========================================================
write("1_geo_deaths_per_million.json", {
    "data": {
        "source": f"{A}/derived/country_totals.csv",
        "transform": f"SELECT gjname, country, continent, deaths_per_M FROM '{A}/derived/country_totals.csv'"
    },
    "geojson": {
        "features": GEO_FEATURES,
        "idField": "name"
    },
    "projection": { "type": "equirectangular" },
    "layers": [{
        "mark": "geo-region",
        "encoding": {
            "region": { "field": "gjname", "type": "nominal" },
            "color": { "field": "deaths_per_M", "type": "quantitative", "title": "Deaths / million" }
        }
    }],
    "width": 1100, "height": 540,
    "title": "Cumulative COVID-19 deaths per million (2020-01 → 2023-05) — 15-country focus, rest of world in neutral"
})

# ===========================================================
# 2) Weekly bar race — new deaths per million by country
# ===========================================================
write("2_bar_race_weekly_deaths.json", {
    "data": {
        "source": f"{A}/derived/weekly.csv",
        "transform": (
            f"SELECT country, continent, week_start, new_deaths_per_M "
            f"FROM '{A}/derived/weekly.csv' "
            f"WHERE week_start >= '2020-03-01' AND week_start <= '2023-05-01' "
            f"ORDER BY week_start, country"
        )
    },
    "layers": [{
        "mark": "bar",
        "encoding": {
            "x": { "field": "country", "type": "nominal" },
            "y": { "field": "new_deaths_per_M", "type": "quantitative", "title": "Weekly new deaths per million" },
            "color": { "field": "continent", "type": "nominal" }
        }
    }],
    "animation": { "kind": "race", "frame_field": "week_start", "duration_ms": 30000 },
    "width": 1200, "height": 540,
    "title": "Weekly new deaths per million — bar race (Mar 2020 → May 2023)"
})

# ===========================================================
# 3) Daily new cases per million — multi-line, top 6 countries
# ===========================================================
PICK_LINES = ("United States","United Kingdom","India","South Korea","Sweden","China")
in_clause = ", ".join(f"'{c}'" for c in PICK_LINES)
write("3_daily_lines.json", {
    "data": {
        "source": f"{A}/derived/daily.csv",
        "transform": (
            f"SELECT location AS country, "
            f"STRFTIME(date::DATE, '%Y-%m-%d') AS date, "
            f"new_cases_smoothed_per_million AS cases_per_M "
            f"FROM '{A}/derived/daily.csv' "
            f"WHERE location IN ({in_clause}) AND new_cases_smoothed_per_million IS NOT NULL "
            f"ORDER BY country, date"
        )
    },
    "layers": [{
        "mark": "line",
        "encoding": {
            "x": { "field": "date", "type": "nominal", "title": "Date" },
            "y": { "field": "cases_per_M", "type": "quantitative", "title": "New cases / million (7-day smoothed)" },
            "color": { "field": "country", "type": "nominal" }
        }
    }],
    "width": 1100, "height": 480,
    "title": "Daily new cases per million — six countries, the four waves visible"
})

# ===========================================================
# 4) Stringency vs deaths_per_M scatter (no causation claim)
# ===========================================================
write("4_stringency_scatter.json", {
    "data": { "source": f"{A}/derived/stringency_vs_outcome.csv" },
    "layers": [
        {
            "mark": "point",
            "encoding": {
                "x": { "field": "stringency_mean", "type": "quantitative", "title": "Mean Oxford stringency index" },
                "y": { "field": "deaths_per_M", "type": "quantitative", "title": "Cumulative deaths per million" },
                "color": { "field": "continent", "type": "nominal" },
                "size": { "field": "vax_fully_pct", "type": "quantitative" }
            }
        },
        {
            "mark": "text",
            "encoding": {
                "x": { "field": "stringency_mean", "type": "quantitative" },
                "y": { "field": "deaths_per_M", "type": "quantitative" },
                "text": { "field": "country", "type": "nominal" }
            }
        }
    ],
    "width": 980, "height": 600,
    "title": "Stringency (mean) × deaths/million × vaccination % (size) — correlation? Causation? See whyboard."
})

# ===========================================================
# 5) CFR over time — line per country
# ===========================================================
write("5_cfr_over_time.json", {
    "data": {
        "source": f"{A}/derived/cfr_over_time.csv",
        "transform": (
            f"SELECT country, continent, "
            f"STRFTIME(month::DATE, '%Y-%m') AS month, "
            f"cfr_pct "
            f"FROM '{A}/derived/cfr_over_time.csv' "
            f"WHERE cfr_pct IS NOT NULL AND cases_in_month > 1000 "
            f"ORDER BY country, month"
        )
    },
    "layers": [{
        "mark": "line",
        "encoding": {
            "x": { "field": "month", "type": "nominal", "title": "Month" },
            "y": { "field": "cfr_pct", "type": "quantitative", "title": "Case-fatality ratio % (14d-lagged)" },
            "color": { "field": "country", "type": "nominal" }
        }
    }],
    "width": 1100, "height": 480,
    "title": "Case-fatality ratio decline (deaths shifted back 14d, monthly buckets, ≥1000 cases/mo)"
})

# ===========================================================
# 6) Treemap — continent → country, size: total_deaths
# ===========================================================
import csv
totals = list(csv.DictReader(open(ROOT/"derived/country_totals.csv")))
from collections import defaultdict
buckets = defaultdict(list)
for r in totals:
    buckets[r["continent"]].append({"name": r["country"], "value": int(r["total_deaths"])})
tree = {"name":"World", "children": [
    {"name": cont, "children": sorted(items, key=lambda x: -x["value"])}
    for cont, items in sorted(buckets.items())
]}
write("6_treemap_deaths.json", {
    "data": { "hierarchy": tree },
    "layers": [{
        "mark": "treemap",
        "encoding": {
            "color": { "field": "depth", "type": "quantitative" },
            "tooltip": ["name","value"]
        }
    }],
    "width": 1100, "height": 540,
    "title": "Total reported COVID-19 deaths — continent → country (area = death count)"
})

# ===========================================================
# 7) Multi-line: % fully vaccinated over time, six countries
# ===========================================================
VAX_PICK = ("Israel","United Kingdom","United States","Germany","India","South Africa")
ic = ", ".join(f"'{c}'" for c in VAX_PICK)
write("7_vax_rollout_lines.json", {
    "data": {
        "source": f"{A}/derived/daily.csv",
        "transform": (
            f"SELECT location AS country, STRFTIME(date::DATE, '%Y-%m-%d') AS date, "
            f"people_fully_vaccinated_per_hundred AS pct_fully_vax "
            f"FROM '{A}/derived/daily.csv' "
            f"WHERE location IN ({ic}) "
            f"  AND people_fully_vaccinated_per_hundred IS NOT NULL "
            f"  AND date >= '2020-12-01' AND date <= '2022-12-31' "
            f"ORDER BY country, date"
        )
    },
    "layers": [{
        "mark": "line",
        "encoding": {
            "x": { "field": "date", "type": "nominal", "title": "Date" },
            "y": { "field": "pct_fully_vax", "type": "quantitative", "title": "% population fully vaccinated" },
            "color": { "field": "country", "type": "nominal" }
        }
    }],
    "width": 1100, "height": 480,
    "title": "Vaccine rollout race — % fully vaccinated, Dec 2020 → Dec 2022 (six representative countries)"
})

# ===========================================================
# 8) Weekday reporting-pattern heatmap (uses my diverging-palette patch)
# ===========================================================
write("8_weekday_heatmap.json", {
    "data": {
        "source": f"{A}/derived/weekday_pattern.csv",
        "transform": (
            f"SELECT country, weekday, (mean_raw_to_smoothed_ratio - 1.0) AS deviation "
            f"FROM '{A}/derived/weekday_pattern.csv' "
            f"ORDER BY country, dow_num"
        )
    },
    "layers": [{
        "mark": "heatmap",
        "encoding": {
            "x": { "field": "weekday", "type": "nominal", "title": "Day of week" },
            "y": { "field": "country", "type": "nominal" },
            "color": { "field": "deviation", "type": "quantitative", "title": "Raw/Smoothed − 1.0  (>0 = over-report, <0 = under-report)" }
        }
    }],
    "width": 760, "height": 520,
    "title": "Reporting cadence by weekday — Mondays bulge with weekend backlog; Sundays often near-zero"
})

# ===========================================================
# 9) Decompose — USA case curve into trend + seasonal + residual (3 facets)
# ===========================================================
# Glyph facet supports col only. We'll plot all 4 fields as separate layers
# with different colors using a long-form derived table.
# Build a melted decompose CSV inline by reading and re-writing.
import csv
src = ROOT/"derived/decompose_United_States.csv"
melted = []
for r in csv.DictReader(open(src)):
    for k in ("actual","trend","seasonal","residual"):
        melted.append({"date": r["date"], "component": k, "value": float(r[k])})
out_path = ROOT/"derived/decompose_USA_long.csv"
with out_path.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["date","component","value"]); w.writeheader(); w.writerows(melted)

write("9_decompose_usa.json", {
    "data": {
        "source": str(out_path),
        "transform": (
            f"SELECT STRFTIME(date::DATE, '%Y-%m-%d') AS date, component, value "
            f"FROM '{out_path}' ORDER BY component, date"
        )
    },
    "layers": [{
        "mark": "line",
        "encoding": {
            "x": { "field": "date", "type": "nominal", "title": "Date" },
            "y": { "field": "value", "type": "quantitative", "title": "Cases/day (smoothed)" },
            "color": { "field": "component", "type": "nominal" }
        }
    }],
    "facet": { "col": "component" },
    "width": 1200, "height": 380,
    "title": "USA new-cases-smoothed decomposed: actual = trend + weekly seasonal + residual"
})

# ===========================================================
# 10) Counterfactual — lives saved per million, bar chart
# ===========================================================
write("10_counterfactual_bars.json", {
    "data": {
        "source": f"{A}/derived/forecast_counterfactual.csv",
        "transform": (
            f"SELECT country, continent, lives_saved_per_M, estimated_lives_saved, pre_vax_cfr_pct "
            f"FROM '{A}/derived/forecast_counterfactual.csv' "
            f"ORDER BY lives_saved_per_M DESC"
        )
    },
    "layers": [{
        "mark": "bar",
        "encoding": {
            "x": { "field": "country", "type": "nominal" },
            "y": { "field": "lives_saved_per_M", "type": "quantitative",
                   "title": "Estimated lives saved per million pop. (vax era, vs pre-vax CFR counterfactual)" },
            "color": { "field": "continent", "type": "nominal" }
        }
    }],
    "width": 1100, "height": 480,
    "title": "Counterfactual lives saved per million — if national CFR had remained at pre-25%-vax baseline"
})

print("done.")
