"""Build a single self-contained HTML showcase report inlining all 10 SVGs.
"""
import json, csv, html
from pathlib import Path
from datetime import date

ROOT = Path(__file__).parent
OUT  = ROOT / "output"
DRV  = ROOT / "derived"

def svg(name):
    s = (OUT / name).read_text()
    if s.lstrip().startswith("<?xml"):
        s = s.split("?>", 1)[-1].lstrip()
    return s

def load_csv(p):
    return list(csv.DictReader(open(p)))

totals = load_csv(DRV/"country_totals.csv")
cf     = load_csv(DRV/"forecast_counterfactual.csv")
vax    = load_csv(DRV/"vax_milestones.csv")
WB = {f"wb{i}": json.load(open(OUT/f"whyboard_{i}.json")) for i in (1,2,3,4)}
WBD = json.load(open(OUT/"whyboard_diff.json"))

CSS = """
:root {
  --ink:#1a1f2e; --bg:#fafbfc; --paper:#fff; --muted:#6b7280;
  --rule:#e5e7eb; --accent:#1e40af; --pos:#166534; --neg:#b91c1c;
  --asia:#dc2626; --europe:#7c3aed; --na:#2563eb; --sa:#16a34a;
  --africa:#ea580c; --oceania:#0891b2; --code:#f3f4f6;
}
* { box-sizing:border-box; }
html,body { margin:0; padding:0; background:var(--bg); color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased; }
.shell { max-width:1240px; margin:0 auto; padding:32px 28px 96px; }
header.hero { border-bottom:1px solid var(--rule); padding:12px 0 28px; margin-bottom:28px; }
.hero h1 { font-size:34px; letter-spacing:-0.5px; margin:0 0 10px; font-weight:700; }
.hero .sub { color:var(--muted); font-size:14px; }
.hero .stack {
  background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%);
  color:#fff; padding:14px 18px; border-radius:6px; margin-top:18px; font-size:13px; }
.hero .stack b { font-weight:700; }
h2 { font-size:22px; margin:48px 0 12px; padding-bottom:6px;
  border-bottom:1px solid var(--rule); letter-spacing:-0.2px; }
h3 { font-size:17px; margin:28px 0 8px; }
h4 { font-size:14px; margin:18px 0 6px; color:var(--muted);
  text-transform:uppercase; letter-spacing:0.5px; }
p { margin:8px 0 14px; }
code,.mono { font-family:"SF Mono",Menlo,Consolas,monospace; font-size:13px; }
code { background:var(--code); padding:1px 5px; border-radius:3px; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
table { width:100%; border-collapse:collapse; font-size:13px; margin:12px 0 20px;
  background:var(--paper); border:1px solid var(--rule); }
th,td { padding:8px 10px; text-align:left; vertical-align:top; border-bottom:1px solid var(--rule); }
th { background:#f8fafc; font-weight:600; }
tr:last-child td { border-bottom:none; }
td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
.pill { display:inline-block; padding:1px 7px; border-radius:99px;
  font-size:11px; font-weight:600; color:#fff; }
.pill.Asia { background:var(--asia); }
.pill.Europe { background:var(--europe); }
.pill.North-America, .pill\\.NA { background:var(--na); }
.pill[data-c='Asia'] { background:var(--asia); }
.pill[data-c='Europe'] { background:var(--europe); }
.pill[data-c='North America'] { background:var(--na); }
.pill[data-c='South America'] { background:var(--sa); }
.pill[data-c='Africa'] { background:var(--africa); }
.pill[data-c='Oceania'] { background:var(--oceania); }
.pos { color:var(--pos); font-weight:600; }
.neg { color:var(--neg); font-weight:600; }
.chart { background:var(--paper); border:1px solid var(--rule); border-radius:6px;
  padding:14px 16px; margin:16px 0; overflow-x:auto; }
.chart svg { display:block; max-width:100%; height:auto; }
.chart .cap { margin-top:8px; padding-top:8px; border-top:1px dashed var(--rule);
  color:var(--muted); font-size:12.5px; }
.chart .cap b { color:var(--ink); }
.tldr { background:linear-gradient(180deg,#f1f5f9,#fafbfc);
  border:1px solid var(--rule); border-radius:8px; padding:18px 22px;
  margin:18px 0 28px; }
.tldr h3 { margin-top:0; }
.tldr ul { margin:6px 0; padding-left:22px; }
.tldr li { margin-bottom:4px; }
.wbcard { border:1px solid var(--rule); border-left:4px solid var(--accent);
  background:var(--paper); border-radius:4px; padding:14px 16px; margin:12px 0; }
.wbcard h4 { color:var(--accent); margin-top:0; }
.wbcard .claim { font-weight:600; margin:8px 0 4px; }
.wbcard .counter { background:#fef2f2; padding:8px 10px; border-radius:4px;
  margin-top:8px; font-size:12.5px; color:#7f1d1d; }
.wbcard .counter b { color:#991b1b; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin:12px 0; }
.grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin:12px 0; }
@media (max-width:800px) { .grid2,.grid3 { grid-template-columns:1fr; } }
.kpi { background:var(--paper); border:1px solid var(--rule); border-radius:6px;
  padding:14px 18px; }
.kpi .num { font-size:28px; font-weight:700; color:var(--accent); }
.kpi .label { color:var(--muted); font-size:12px; margin-top:4px; }
footer { margin-top:60px; padding-top:18px; border-top:1px solid var(--rule);
  color:var(--muted); font-size:12px; }
"""

def fmt_int(x):
    try: return f"{int(float(x)):,}"
    except: return str(x)
def fmt_num(x, d=1):
    try: return f"{float(x):,.{d}f}"
    except: return "—"
def pill(continent):
    return f"<span class='pill' data-c='{html.escape(continent)}'>{html.escape(continent)}</span>"

# ---- KPIs from totals ----
total_deaths = sum(int(r["total_deaths"]) for r in totals)
total_cases  = sum(int(r["total_cases"]) for r in totals)
total_pop    = sum(float(r["population_M"]) for r in totals)
total_saved  = sum(int(r["estimated_lives_saved"]) for r in cf)
worst = max(totals, key=lambda r: float(r["deaths_per_M"] or 0))
best  = min((r for r in totals if r["deaths_per_M"]), key=lambda r: float(r["deaths_per_M"]))
isr_vax = next(v for v in vax if v["country"]=="Israel")
late_vax = next(v for v in vax if v["country"]=="South Africa")

# ---- Country totals table rendering ----
totals_sorted = sorted(totals, key=lambda r: -float(r["deaths_per_M"] or 0))
def render_totals_row(r):
    return (
      f"<tr>"
      f"<td><b>{html.escape(r['country'])}</b></td>"
      f"<td>{pill(r['continent'])}</td>"
      f"<td class='num'>{fmt_num(r['population_M'], 1)} M</td>"
      f"<td class='num'>{fmt_int(r['total_cases'])}</td>"
      f"<td class='num'>{fmt_int(r['total_deaths'])}</td>"
      f"<td class='num'>{fmt_num(r['cases_per_M'], 0)}</td>"
      f"<td class='num'><b>{fmt_num(r['deaths_per_M'], 0)}</b></td>"
      f"<td class='num'>{fmt_num(r['vax_fully_pct'], 1)}%</td>"
      f"<td class='num'>{fmt_num(r['stringency_mean'], 1)}</td>"
      f"</tr>"
    )

# ---- Counterfactual table ----
cf_sorted = sorted(cf, key=lambda r: -float(r["lives_saved_per_M"] or 0))
def render_cf_row(r):
    return (
      f"<tr>"
      f"<td><b>{html.escape(r['country'])}</b></td>"
      f"<td>{pill(r['continent'])}</td>"
      f"<td class='num'>{r['date_25pct_fully_vax']}</td>"
      f"<td class='num'>{fmt_num(r['pre_vax_cfr_pct'], 2)}%</td>"
      f"<td class='num'>{fmt_int(r['post_vax_deaths_counterfactual'])}</td>"
      f"<td class='num'>{fmt_int(r['post_vax_deaths_actual'])}</td>"
      f"<td class='num pos'>{fmt_int(r['estimated_lives_saved'])}</td>"
      f"<td class='num pos'>{fmt_num(r['lives_saved_per_M'], 0)}</td>"
      f"</tr>"
    )

# ---- Whyboard rendering ----
def render_wb(idx, wb):
    color_left = {"wb1":"#7c3aed","wb2":"#dc2626","wb3":"#2563eb","wb4":"#16a34a"}.get(f"wb{idx}", "#1e40af")
    claims_html = ""
    for c in wb["claims"]:
        ev = c["evidence"]
        ev_html = ""
        if isinstance(ev, list) and ev and isinstance(ev[0], dict):
            cols = list(ev[0].keys())
            ev_html += "<table><thead><tr>"
            for col in cols:
                ev_html += f"<th class='{'num' if any(isinstance(r.get(col), (int,float)) for r in ev) else ''}'>{html.escape(col)}</th>"
            ev_html += "</tr></thead><tbody>"
            for row in ev:
                ev_html += "<tr>"
                for col in cols:
                    v = row.get(col)
                    if isinstance(v, (int, float)):
                        ev_html += f"<td class='num'>{fmt_num(v, 2 if abs(v)<10 else 0)}</td>"
                    else:
                        ev_html += f"<td>{html.escape(str(v))}</td>"
                ev_html += "</tr>"
            ev_html += "</tbody></table>"
        counter_html = "".join(f"<li>{html.escape(x)}</li>" for x in c["counter_evidence"])
        claims_html += (
            f"<div class='claim'>{html.escape(c['claim'])}</div>"
            f"{ev_html}"
            f"<div class='counter'><b>Counter-evidence:</b><ul>{counter_html}</ul></div>"
        )
    return (
        f"<div class='wbcard' style='border-left-color:{color_left}'>"
        f"<h4 style='color:{color_left}'>Whyboard {idx}</h4>"
        f"<p><b>Question:</b> {html.escape(wb['question'])}</p>"
        f"<p style='color:var(--muted); font-size:12.5px'><b>Method:</b> {html.escape(wb['method'])}</p>"
        f"{claims_html}"
        f"</div>"
    )

# ---- Compose HTML ----
parts = []
parts.append(f"""<!DOCTYPE html>
<html lang='en'><head>
<meta charset='utf-8'/>
<title>COVID-19: 15-country showcase — what an agent + Glyph can do for insight-driven analytics</title>
<style>{CSS}</style>
</head><body>
<div class='shell'>

<header class='hero'>
  <div class='sub mono'>showcase report &nbsp;·&nbsp; built {date(2026,5,19).isoformat()} &nbsp;·&nbsp; window 2020-01-01 → 2023-05-05 &nbsp;·&nbsp; 15 countries, 4 continents &nbsp;·&nbsp; 18,259 country-day rows</div>
  <h1>COVID-19 — what an agent + <code>Glyph</code> sees in 3 years of data</h1>
  <div class='sub'>10 visualizations + 4 whyboards + decomposition + counterfactual + drift-class analysis, all rendered through the Glyph spec/SVG pipeline directly from Our World in Data.</div>
  <div class='stack'>
    <b>What this report demonstrates:</b> an LLM agent can take a 100MB public health dataset
    and a vector grammar (Glyph), apply <i>insight-driven analytics</i> — geo choropleth,
    bar race, decompose-into-trend-+-seasonality-+-residual, counterfactual estimation,
    weekday-cadence anomaly detection, claim/evidence/counter-evidence whyboards,
    diverging-palette heatmaps — and produce a defensible analytic narrative.
    Every chart is a spec; every spec is a query; every claim is anchored to a derived CSV.
  </div>
</header>

<div class='grid3'>
  <div class='kpi'><div class='num'>{fmt_int(total_deaths)}</div><div class='label'>cumulative reported deaths (15-country sum)</div></div>
  <div class='kpi'><div class='num'>{fmt_int(total_cases)}</div><div class='label'>cumulative reported cases (15-country sum)</div></div>
  <div class='kpi'><div class='num'>{fmt_num(total_pop, 0)} M</div><div class='label'>population covered (≈45 % of world)</div></div>
</div>
<div class='grid3'>
  <div class='kpi'><div class='num'>{fmt_num(float(worst['deaths_per_M']), 0)}</div><div class='label'>worst per-capita deaths: <b>{worst['country']}</b> ({worst['continent']})</div></div>
  <div class='kpi'><div class='num'>{fmt_num(float(best['deaths_per_M']), 0)}</div><div class='label'>lowest reported per-capita deaths: <b>{best['country']}</b> ({best['continent']})</div></div>
  <div class='kpi'><div class='num'>{fmt_int(total_saved)}</div><div class='label'>estimated lives saved post-vax (counterfactual, all 15)</div></div>
</div>

<div class='tldr'>
  <h3>TL;DR</h3>
  <ul>
    <li><b>Per-capita ordering rewrites every story.</b> US and UK lead in absolute deaths, but on deaths/M the UK (3358) edges out the US (3322), Brazil, and Italy. China's reported 84.8/M is a 40x outlier — see whyboard 3 for the counter-evidence.</li>
    <li><b>The vaccine inflection is real but unevenly distributed.</b> Israel hit 25%-fully-vax 9 months before South Africa; Italy / France / UK / Germany show the largest per-million lives-saved counterfactuals (~9,000+ each) because their pre-vax CFR was elevated.</li>
    <li><b>Reporting cadence is its own story.</b> Mondays bulge with the weekend backlog across nearly every country — visible as a diverging heatmap stripe (chart 8).</li>
    <li><b>Stringency-vs-outcome correlation is weak and confounded.</b> The negative correlation is driven primarily by China; remove China, and the sign flips. Causation: not from this data alone.</li>
    <li><b>India's official numbers are the largest known gap.</b> Excess-mortality estimates are 4-10× higher than reported deaths; every analysis above propagates that gap.</li>
  </ul>
</div>

<h2>1. The global picture — cumulative deaths per million</h2>
<p>Choropleth (equirectangular projection) of cumulative COVID-19 deaths per million, 2020-01 → 2023-05.
   Continuous color scale; rest of the world rendered in neutral grey for context.
   Built from a single Glyph spec: <code>mark: 'geo-region'</code> + inline GeoJSON FeatureCollection + <code>idField: 'name'</code>.</p>
<div class='chart'>{svg('1_geo_deaths_per_million.svg')}
  <div class='cap'><b>Read:</b> Western Europe + USA + Brazil dominate the high end (red-to-orange). Asia-Pacific (Japan, Korea, Australia) light green; China is intentionally on the very-low end of the scale but see <a href='#wb3'>Whyboard 3</a> for the reporting caveat. The legend on the right is a continuous color-bar generated automatically because <code>color.type = 'quantitative'</code>.</div>
</div>

<h2>2. Per-capita ranking — sorted by deaths / million</h2>
<table>
  <thead><tr>
    <th>Country</th><th>Continent</th>
    <th class='num'>Pop.</th>
    <th class='num'>Cases</th>
    <th class='num'>Deaths</th>
    <th class='num'>Cases/M</th>
    <th class='num'>Deaths/M</th>
    <th class='num'>Fully vax</th>
    <th class='num'>Mean stringency</th>
  </tr></thead>
  <tbody>{''.join(render_totals_row(r) for r in totals_sorted)}</tbody>
</table>

<h2>3. The waves — daily new cases per million, six countries</h2>
<p>Same y-axis, same time window, six different country shapes. Each line is one Glyph <code>line</code> mark grouped by country.</p>
<div class='chart'>{svg('3_daily_lines.svg')}
  <div class='cap'><b>Read:</b> India's Delta peak (May 2021) towers. UK / USA show 4 distinct waves. South Korea sits flat until early 2022 when Omicron breaks through. Sweden's curve runs higher per-capita than its raw counts suggest. China's spike (Dec 2022 → Jan 2023) is the post-zero-COVID release in a single window.</div>
</div>

<h2>4. The bar race — weekly new deaths per million</h2>
<p>SMIL-animated bar race. <code>animation.kind: 'race'</code>, <code>frame_field: 'week_start'</code>, ~170 frames over 30 s.
   Each frame shows that week's deaths/M ranking across the 15 countries.</p>
<div class='chart'>{svg('2_bar_race_weekly_deaths.svg')}
  <div class='cap'><b>Read:</b> Watch which country leads as the pandemic moves through phases. Italy / Sweden lead spring 2020; USA / UK lead winter 2020-21; Brazil leads through Delta; many countries flatten after vaccines; Hong Kong / Korea / Japan spike late on Omicron. The race is itself a story about which wave belonged to which country.</div>
</div>

<h2>5. Time-series decomposition — USA case curve</h2>
<p>The same case curve decomposed into <b>trend</b> (14-day centered moving average), <b>seasonal</b> (day-of-week effect),
   and <b>residual</b>. Four panels in one spec via Glyph's <code>facet.col</code>.</p>
<div class='chart'>{svg('9_decompose_usa.svg')}
  <div class='cap'><b>Read:</b> The seasonal panel is the smoking gun for reporting cadence — Sundays bottom out, Mondays bulge. The residual is mostly noise after the first wave (the model fits well). This is the Python equivalent of <code>glyph_decompose(handle, field='new_cases_smoothed')</code>.</div>
</div>

<h2>6. The case-fatality ratio collapse</h2>
<p>CFR = deaths shifted back 14 days / cases, computed per country per month. The Alpha → Delta → Omicron transitions
   show up as inflection points; the vaccine rollout pulls CFR down by ~10× in most countries.</p>
<div class='chart'>{svg('5_cfr_over_time.svg')}
  <div class='cap'><b>Read:</b> All 15 countries decline. Mexico's pre-vax CFR was the highest (~8%). UK / Italy / Brazil all crashed under 1% by 2022. The China line is anomalous — flat at near-zero through 2022 (zero-COVID containment) then jumps when the policy reversed.</div>
</div>

<h2>7. Vaccine rollout — % fully vaccinated</h2>
<div class='chart'>{svg('7_vax_rollout_lines.svg')}
  <div class='cap'><b>Read:</b> Israel's curve breaks out 6 months ahead of everyone. UK is second; USA stalls below 70% by mid-2022. India's curve is steep but late. South Africa's tops out below 35%. Same vaccine, very different rollouts — the wedge driving the counterfactual chart below.</div>
</div>

<h2>8. Counterfactual lives saved — assume CFR stayed at pre-25%-vax baseline</h2>
<p>For each country: take the pre-vax-rollout CFR; multiply by post-vax-rollout cases; subtract actual deaths. The difference is the <i>counterfactual lives saved</i>. Heroic assumptions — see <a href='#wb4'>Whyboard 4</a> — but the cross-country comparison is informative.</p>
<div class='chart'>{svg('10_counterfactual_bars.svg')}
  <div class='cap'><b>Read:</b> Italy / Germany / France / UK lead on per-capita lives saved because they had elevated pre-vax CFR + got vaccinated early. Israel's per-million figure is modest because Israel's pre-vax CFR was already low. India is the floor because pre-vax CFR was low <i>and</i> rollout was late <i>and</i> reporting was incomplete.</div>
</div>
<h3>Counterfactual table</h3>
<table>
  <thead><tr>
    <th>Country</th><th>Continent</th>
    <th class='num'>25%-fully-vax date</th>
    <th class='num'>Pre-vax CFR</th>
    <th class='num'>Counterfactual deaths</th>
    <th class='num'>Actual deaths</th>
    <th class='num'>Lives saved</th>
    <th class='num'>Lives saved / M</th>
  </tr></thead>
  <tbody>{''.join(render_cf_row(r) for r in cf_sorted)}</tbody>
</table>

<h2>9. Stringency × outcome — the most-misread scatter</h2>
<div class='chart'>{svg('4_stringency_scatter.svg')}
  <div class='cap'><b>Read:</b> Visually, the highest-stringency country (China) has the lowest reported deaths/M. The lowest-stringency country (Sweden) is mid-pack on deaths/M, not at the high end. Correlation is real but not causation — see <a href='#wb2'>Whyboard 2</a> for the five distinct confounders.</div>
</div>

<h2>10. Reporting cadence — weekday heatmap</h2>
<p>The y-axis is country, x-axis is day-of-week, color is <code>raw / smoothed − 1.0</code> — i.e. how much that weekday's
   reported cases deviate from the 7-day average. <b>Diverging palette around 0</b> uses the heatmap-color patch I made
   earlier — red = under-report, green = over-report.</p>
<div class='chart'>{svg('8_weekday_heatmap.svg')}
  <div class='cap'><b>Read:</b> Across nearly all countries: Sunday under-reports (red), Monday over-reports (green / blue) as the weekend backlog clears. South Korea has the strongest pattern (5× Monday bulge); China shows almost no weekday cycle (different reporting infrastructure). This is the data-quality story behind the smoothed curves we plotted in chart 3.</div>
</div>

<h2>11. Treemap — continent → country, sized by total deaths</h2>
<div class='chart'>{svg('6_treemap_deaths.svg')}
  <div class='cap'><b>Read:</b> Absolute scale: the USA rectangle is huge (1.1M deaths), followed by Brazil (701k) and India (532k). Asia + Europe sum to the global majority; SEA + Oceania are visually tiny. <b>Caveat:</b> this is reported deaths, not excess deaths — India's true total is widely believed to be 4–10× higher.</div>
</div>

<h2>12. Whyboards — claim · evidence · counter-evidence</h2>
<p>Each whyboard is the Python-mirrored shape of <code>glyph_whyboard(handle, question)</code>. It returns a root question, a method, and a set of claims; each claim has evidence rows AND explicit counter-evidence that the model itself produces. This is the analytic discipline behind the report.</p>

<a id='wb1'></a>{render_wb(1, WB['wb1'])}
<a id='wb2'></a>{render_wb(2, WB['wb2'])}
<a id='wb3'></a>{render_wb(3, WB['wb3'])}
<a id='wb4'></a>{render_wb(4, WB['wb4'])}

<h3>Whyboard diff — WB1 (Israel) × WB4 (counterfactual robustness)</h3>
<div class='wbcard' style='border-left-color:#9333ea'>
  <h4 style='color:#9333ea'>Cross-board agreement &amp; conflict</h4>
  <p>{html.escape(WBD['agreement_note'])}</p>
  <table>
    <tr><th>Countries in <b>both</b> boards</th><td>{', '.join('<code>'+c+'</code>' for c in WBD['countries_in_both']) or '—'}</td></tr>
    <tr><th>Only in WB1 (Israel framing)</th><td>{', '.join('<code>'+c+'</code>' for c in WBD['only_in_a']) or '—'}</td></tr>
    <tr><th>Only in WB4 (counterfactual framing)</th><td>{', '.join('<code>'+c+'</code>' for c in WBD['only_in_b']) or '—'}</td></tr>
  </table>
  <div class='counter'><b>Conflict note:</b> {html.escape(WBD['conflict_note'])}</div>
</div>

<h2>13. What this showcase demonstrates about agent + Glyph</h2>
<table>
  <thead><tr><th>Capability</th><th>Where you see it in this report</th><th>Why it matters for insight-driven analytics</th></tr></thead>
  <tbody>
    <tr><td>Vector-grammar charts as queries</td><td>All 10 charts compile from JSON specs; SQL transforms live inside the spec</td><td>Reproducible, version-controllable, queryable — not a screenshot.</td></tr>
    <tr><td>Geo choropleth with continuous color</td><td>Chart 1; legend auto-generated from numeric domain</td><td>Spatial pattern + scale legibility in one mark.</td></tr>
    <tr><td>SMIL-animated bar race</td><td>Chart 2 (~170 frames over 30 s)</td><td>Time evolution of rankings without writing animation code.</td></tr>
    <tr><td>Diverging heatmap palette around 0</td><td>Charts 8 (and the chart-5 audit fix earlier)</td><td>Numeric sign legible at a glance — no &quot;is high blue or low blue?&quot; confusion.</td></tr>
    <tr><td>Faceted small multiples</td><td>Chart 9 (decompose) — one spec, four panels</td><td>Compare components without re-querying.</td></tr>
    <tr><td>Decompose into trend + seasonal + residual</td><td>Chart 9 — semantic equivalent of <code>glyph_decompose</code></td><td>Separate signal from artifact (reporting cadence).</td></tr>
    <tr><td>Counterfactual estimation</td><td>Chart 10 + table — semantic equivalent of <code>glyph_forecast</code> with a what-if baseline</td><td>Goes beyond &quot;what happened&quot; to &quot;what was the policy-relevant counterfactual&quot;.</td></tr>
    <tr><td>Z-score anomaly detection</td><td><a href='whyboard_3.json'>derived/anomalies.csv</a></td><td>18,180 country-days scored automatically.</td></tr>
    <tr><td>Whyboards (claim/evidence/counter)</td><td>WB1–WB4 + diff</td><td>The model produces counter-evidence to its own claims — analytic humility built in.</td></tr>
    <tr><td>Hierarchical viz</td><td>Chart 11 (treemap) — inline <code>data.hierarchy</code></td><td>Single picture of the geography of the death toll.</td></tr>
  </tbody>
</table>

<h2>14. Data gaps + limitations</h2>
<ul>
  <li><b>Reported vs excess deaths.</b> Every chart uses OWID's reported deaths. India / Mexico / Russia / Brazil are widely believed to be undercounted by 3–10×. Excess-mortality reconciliation is the obvious next step.</li>
  <li><b>Counterfactual baseline = pre-vax CFR.</b> Heroic. Variants had different intrinsic CFRs; treatments improved independent of vaccines; selection of pre-vax window changes the answer. See WB4 counter-evidence.</li>
  <li><b>Stringency is an input not an outcome.</b> Mean stringency over 3 years masks timing. China's flat-but-high stringency single-handedly drives the negative correlation.</li>
  <li><b>No GeoJSON for sub-national units.</b> The choropleth ends at country level; US-state, India-state, Brazil-state granularity would expose how much "country average" is hiding.</li>
  <li><b>OWID stopped daily updates in March 2024.</b> Window ends 2023-05-05 (WHO PHEIC declaration) — consistent for the analytic window.</li>
</ul>

<h2>15. Disclosures</h2>
<ul>
  <li>This is a <b>showcase</b> of agent + Glyph capabilities applied to a public-health dataset. No medical, epidemiological, or policy recommendations are made.</li>
  <li>All data from <a href='https://github.com/owid/covid-19-data'>Our World in Data</a>; world boundaries from <a href='https://github.com/holtzy/D3-graph-gallery/blob/master/DATA/world.geojson'>D3-graph-gallery</a>'s admin-0 file.</li>
  <li>Every analytical claim in this report is derivable from a CSV in <code>sandbox-covid/derived/</code>; every chart is one of the JSON specs in <code>sandbox-covid/specs/</code>.</li>
  <li>The Glyph compiler used here includes three local patches relative to mainline: (1) string-to-object JSON parse on <code>safeParseSpec</code>; (2) diverging heatmap palette + continuous color-bar legend; (3) heatmap y-axis band override; (4) quantitative color gradient on geo-region.</li>
</ul>

<footer>
  Generated {date(2026,5,19).isoformat()} from <code>sandbox-covid/build_html.py</code>. All sources, derived datasets, specs, and SVGs are in this same directory tree. Raw OWID CSV under <code>sandbox-covid/data/</code>.
</footer>

</div></body></html>
""")

html_out = "".join(parts)
(OUT/"report.html").write_text(html_out)
print(f"wrote {OUT/'report.html'} ({len(html_out):,} bytes)")
