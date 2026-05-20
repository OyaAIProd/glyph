# COVID-19 showcase — what an agent + Glyph can do for insight-driven analytics

A self-contained example that takes 3 years of public COVID-19 data
(Our World in Data) and produces a single HTML report combining 10
visualizations, 4 whyboards, time-series decomposition, and a
counterfactual lives-saved estimate — all rendered through the Glyph
spec/SVG pipeline.

**Open `output/report.html` to see the finished thing.**

## What's in here

```
sandbox-covid/
├── README.md                    ← you are here
├── build_data.py                ← step 1: subset OWID → derived/
├── build_specs.py               ← step 2: write 10 Glyph spec JSONs
├── build_whyboards.py           ← step 3: claim / evidence / counter-evidence
├── build_html.py                ← step 4: assemble single-file report
├── data/
│   ├── world.geojson            ← admin-0 boundaries (250 KB, committed)
│   └── owid-covid-data.csv      ← raw OWID (94 MB, gitignored; fetched by build_data.py)
├── derived/                     ← reproducible analytical datasets (CSV + JSON)
├── specs/                       ← 10 Glyph spec JSONs (chart-as-query)
└── output/
    ├── 1_geo_deaths_per_million.svg    ← global choropleth
    ├── 2_bar_race_weekly_deaths.svg    ← SMIL-animated weekly race
    ├── 3_daily_lines.svg               ← 6-country cases-per-million
    ├── 4_stringency_scatter.svg        ← stringency × deaths × vax-rate
    ├── 5_cfr_over_time.svg             ← case-fatality ratio decline
    ├── 6_treemap_deaths.svg            ← continent → country by death count
    ├── 7_vax_rollout_lines.svg         ← vaccine rollout race
    ├── 8_weekday_heatmap.svg           ← reporting cadence
    ├── 9_decompose_usa.svg             ← trend + seasonal + residual facet
    ├── 10_counterfactual_bars.svg      ← lives saved per million
    ├── whyboard_{1..4}.json + diff     ← claim/evidence/counter trees
    └── report.html                     ← single self-contained HTML showcase
```

## Reproduce

From this directory:

```sh
# 1. Download the OWID CSV (~94 MB; one-shot)
curl -L -A "Mozilla/5.0" \
  https://raw.githubusercontent.com/owid/covid-19-data/master/public/data/owid-covid-data.csv \
  -o data/owid-covid-data.csv

# 2. Build derived datasets (15 countries × 1,212 days = 18,259 rows)
python3 build_data.py

# 3. Write the 10 Glyph specs (JSON files in specs/)
python3 build_specs.py

# 4. Render charts via the Glyph CLI
GLYPH=../packages/cli/dist/bin.js
for i in 1 2 3 4 5 6 7 8 9 10; do
  SPEC=$(ls specs/${i}_*.json)
  node $GLYPH render "$SPEC" -o "output/$(basename $SPEC .json).svg"
done

# 5. Compute the whyboards (claim / evidence / counter-evidence)
python3 build_whyboards.py

# 6. Assemble the single-file HTML report
python3 build_html.py
open output/report.html
```

## Country universe

15 countries spanning 5 continents and diverse pandemic responses:

- **Americas:** United States, Brazil, Mexico
- **Europe:** United Kingdom, Germany, France, Italy, Sweden (Nordic outlier)
- **Asia:** Israel (first-mover vax), Japan, South Korea, India, China (zero-COVID)
- **Africa:** South Africa
- **Oceania:** Australia

Window: **2020-01-01 → 2023-05-05** (WHO end-of-PHEIC declaration).

## What Glyph features the report demonstrates

| Capability | Where in the report |
|---|---|
| `mark: "geo-region"` with continuous color gradient + auto legend | Chart 1 |
| `animation.kind: "race"` (SMIL bar race) | Chart 2 |
| `mark: "line"` grouped by color domain | Charts 3, 5, 7 |
| Faceted small multiples (`facet.col`) | Chart 9 (4 panels: actual, trend, seasonal, residual) |
| `mark: "heatmap"` with diverging palette (around 0) + continuous legend | Chart 8 |
| `mark: "treemap"` with inline `data.hierarchy` | Chart 6 |
| Multi-layer specs (point + text) | Chart 4 |
| SQL `data.transform` for in-spec aggregation | Throughout |
| Tick label thinning + rotation when bands are dense | Charts 2, 3, 7, 9, 10 |
| Categorical color legends (`continent`, `country`, …) | Most charts |
| Continuous color legends (`deaths_per_M`, z-scores …) | Charts 1, 8 |
| Whyboards: claim / evidence / counter-evidence trees | `output/whyboard_{1..4}.json` |

## Sources

- [Our World in Data — COVID-19 dataset](https://github.com/owid/covid-19-data)
- [holtzy/D3-graph-gallery — world.geojson](https://github.com/holtzy/D3-graph-gallery/blob/master/DATA/world.geojson)

## Caveats

- **Reported vs excess deaths.** OWID's reported deaths undercount India / Mexico / Russia / Brazil by 3–10×; the counterfactual chart inherits that gap.
- **7-day windows are noise; 3-year windows are texture.** Long-term policy conclusions need many more confounders than this report controls for.
- **Stringency / outcome correlation is dominated by single observations.** Remove China and the correlation sign flips — see Whyboard 2.
- **OWID stopped daily updates in March 2024.** Window ends 2023-05-05; consistent for analysis.

This is a **technical showcase**, not a public-health study. No medical, epidemiological, or policy recommendations are made.
