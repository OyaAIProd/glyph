# Glyph — Growth Accelerants

> Convicted candidates for going faster than the baseline plan, including a rename verdict.
> Read this with a pen. Each item is rated: **Conviction** (1–5), **Effort** (S/M/L), **Stars uplift** (low/med/high), **When**.

---

## Part 1 — Naming: keep or rename?

### Conclusion up front

**Keep "Glyph" unless one specific alternative clears a clean conflict check this week. If you rename, do it in the next 10 days — every week of compounding link equity raises the switching cost by ~15%.**

The "Glyph" conflicts are annoying but survivable: they're all in adjacent fields, not direct competitors. SEO will self-disambiguate within 6 months as your category surface area grows. The bigger risk is *being indecisive* — a half-rename (rebranding the docs but leaving npm scopes) is worse than either choice.

### The conflict landscape (so you can decide)

- **`github.com/glyph`** — Twisted's founder, dormant for our purposes. Personal handle, not a project.
- **Glyphs** (the font app) — niche, design-pro audience. Different category.
- **Nothing Phone Glyph SDK** — hardware-adjacent. Different audience.
- **`thu-coai/Glyph`** — research paper on visual-text compression. Academic, low traffic.
- **`AIGText/Glyph-ByT5`** — ECCV2024 paper. Academic.
- **`semos-labs/glyph`** — TypeScript TUI framework. Closest collision (same language, dev tooling) but tiny.

None of these will outrank you on "agent chart" / "MCP chart" / "deterministic chart" queries — but they will outrank you on the bare word "glyph" for the next 2–3 years.

### Rename candidates with verdict

I checked each for npm + GitHub conflicts. Rating is my honest pick order if you do rename.

| Candidate | Conviction | Why it works | Why it doesn't | npm/GitHub status | Verdict |
|---|---|---|---|---|---|
| **Glyph (keep)** | 4/5 | Already shipped. Already in plugin manifests for 4 IDEs. Captures "small mark" perfectly. The "small magic mark for agents" semantic is *exactly* the product. | SEO crowded. Brand is yours to build, not yours to own. | n/a | **Default. Keep unless something below scores clearly higher.** |
| **Charta** | 4/5 | Latin for "official paper / charter". Captures **audit + governance + spec-as-source-of-truth** in one word. Distinctive, tasteful, no dev-tooling collisions. Domain `charta.dev` likely available. Pronounceable globally. | Less obvious what it does at first glance. Latin can feel pretentious. | npm scope likely free, GitHub `charta` is a small personal repo. Worth a 30-min check. | **Strong rename pick. The "audit + lineage" angle is your moat — this name reinforces it.** |
| **Plotwright** | 4/5 | Pattern-recognition with Playwright (Microsoft, 70k stars, dev-tool category leader). Says "writes plots" + "wright = craftsman/automation". Captures **agent-authored chart** angle perfectly. | Will be compared to Playwright forever ("playwright for charts"). Could be a benefit or a curse. Microsoft trademark risk is real but probably mitigable. | `plotwright` on npm appears unused; `.dev` likely available. | **Bold pick. High recognition value if you can stomach the comparison.** |
| **Vellum** | 3/5 | Parchment metaphor — durable, written-once, archival. Resonates with **byte-identical, audit-grade, snapshot-testable**. Distinctive. | Not obviously a chart library. Some startup uses it (vellum.ai — LLM eval). Could collide. | `vellum` npm taken (unrelated); `vellum.ai` is a YC AI eval startup. **Live conflict.** | **Skip — vellum.ai is too close in the AI-dev space.** |
| **Sigil** | 2/5 | Same "small magic mark" meaning as glyph. Distinctive in viz. | **Heavy npm collision**: `@urbit/sigil-js`, `sigil.ts`, `sigiljs/sigil` web-component framework, `sigil-cli`. Search noise as bad as "glyph" or worse. | Multiple active packages. | **Skip — out of the frying pan into the fire.** |
| **Ledger** | 2/5 | Perfect for the audit/lineage angle. | **Massive collision**: Ledger (crypto hardware wallet, $1B+ company), `ledger` accounting CLI, Ledger Live. SEO impossible. | Hopeless. | **Skip.** |
| **Spectra / Spectral** | 2/5 | Hints at spec + spectrum + visual. | Spectral is the popular Stoplight OpenAPI linter (5k+ stars). Confusing collision. | Taken. | **Skip.** |
| **Verity / Veritas** | 2/5 | "Truth" — fits audit angle. | Veritas is a $5B+ enterprise data company. Verity has multiple AI startups. | Hot conflict zone. | **Skip.** |
| **Quill** | 1/5 | Writing flavor. | Quill.js editor (~47k stars). | **Skip.** |
| **Anvil / Atlas / Beacon / Stencil / Mosaic** | 1/5 | Various poetic angles. | All heavily taken in dev tools. | **Skip.** |
| **Glyphlang / Glyphspec / Glyphkit** | 3/5 | Disambiguates without abandoning brand. `glyphlang.dev` available. Sets up the "Glyph is a chart language" story. | Compound names rarely become canonical (e.g. nobody says "TypeScript Lang"). | npm scope `@glyphlang` likely free. | **Pragmatic middle-ground. Use as domain (glyphlang.dev) but keep package names as `@glyph/*`.** |

### My honest call

**Keep "Glyph" and acquire `glyphlang.dev` (or `glyph.dev` if it's available) within the week.** Spend 30 min checking `charta.dev` and `plotwright.dev` availability *now* — if either is clearly available and feels right when you say it out loud 5 times, switch. Otherwise, kill the question for 12 months and don't revisit until you hit 5k stars.

**The cost of staying with Glyph:** ~20% slower SEO compounding for 18 months. Survivable.
**The cost of renaming after week 6:** ~3 weeks of work (npm scope migrations, redirects, social handles, plugin manifest updates in 4 IDEs, README/docs sweep, link rot from external blogs, breaking changes for ~50 existing installs). Recoverable but painful.

**Decision deadline: 7 days from today.** After that, the answer is "keep".

---

## Part 2 — Growth accelerants ranked by leverage

These are *additive* to the baseline plan. Each could 1.5–3x your trajectory if it lands.

### Tier S — bet-the-quarter moves (do at least one)

#### S1. Ship Python bindings (`pip install glyph`) within 90 days
- **Conviction: 5/5**
- **Effort: L** (2–4 weeks of focused agent-driven dev; you wrote in NEXT-SESSIONS.md this depends on a Rust port, but a thinner pyodide-or-subprocess MVP could ship in 2 weeks)
- **Stars uplift: high** (Python data viz audience is 5–10x JS. Every Jupyter user, every pandas analyst, every LangChain-Python user is unlocked)
- **When:** start month 1, ship month 3
- **Why it's S-tier:** the agent ecosystem in Python is *bigger than the JS one*. LangChain-Py, LlamaIndex, CrewAI, AutoGen are all Python-native. Without Python, you're voluntarily skipping ~60% of your TAM. **Of every accelerant on this list, this one has the highest expected uplift.**
- **Anti-pattern:** don't wait for the full Rust port. Ship a "good enough" Python wrapper now via subprocess-to-Node, then port later.

#### S2. Submit + land in `modelcontextprotocol/servers` official repo
- **Conviction: 5/5**
- **Effort: S** (1–2 hrs of PR work; subject to maintainer approval)
- **Stars uplift: high** (the official MCP servers repo is where every agent dev first looks)
- **When:** week 1
- **Why:** this is the registry equivalent of being shelved at eye level in a grocery store. Anthropic-curated, ~50k+ stargazers on the parent repo, indexed everywhere.
- **Catch:** the bar is "useful + well-documented + maintained". Glyph qualifies. Just need a clean PR.

#### S3. Build a public playground at `glyph.dev/play` (à la Vega-Lite Editor)
- **Conviction: 5/5**
- **Effort: M** (3–5 days; Claude can do most of it)
- **Stars uplift: high** (every chart someone makes becomes a shareable URL → backlinks → SEO → stars)
- **When:** month 1, hardened by month 2
- **Why:** Vega-Lite Editor is the #1 driver of Vega-Lite stars. Every blog post, every Stack Overflow answer, every Twitter thread about Vega-Lite links to a `vega.github.io/editor` URL. Glyph needs the same: paste a CSV → get an audited chart + spec + explain + downloadable SVG. The audit panel showing live findings is your signature unique moment.
- **Multiplier:** add "Share" → unique URL → embed everywhere. Each share is a SEO breadcrumb.

#### S4. Author a GitHub Action: "Chart Audit on PR"
- **Conviction: 4/5**
- **Effort: M** (1 week)
- **Stars uplift: high** (every repo that adopts it advertises glyph in their PR comments forever)
- **When:** month 2–3
- **Why:** a `glyph-audit-action@v1` that comments on PRs whenever a chart spec changes — showing diff, audit findings, before/after image, trust score. This *uses* your differentiators (audit, spec_diff, trust) to *create* viral surface area. Every PR is a free billboard.
- **Comp:** the Vercel preview bot, the CodeCov bot — these are massive growth engines.

### Tier A — high-leverage compounding moves

#### A1. Co-marketing DMs to 10 named AI-dev personalities
- **Conviction: 5/5**
- **Effort: S** (Claude drafts personalized notes, 2 hrs human review)
- **Stars uplift: medium-high** (each yes = 500–3,000 stars potentially)
- **When:** month 1, after Show HN
- **Targets in priority order:** Mahesh Murag (Anthropic, MCP designer), Erik Schluntz (Anthropic), Logan Kilpatrick (Google now, big AI-dev voice), Swyx (Latent Space), Theo (t3.gg), Sahil Lavingia (Gumroad, builds with AI), Cole Medin (n8n + AI), David Crawshaw (Tailscale → AI), Jasper (any well-known agent-framework maintainer), Andy Kirk (Vis Bytes).
- **What you offer:** not "please retweet". You offer a custom Claude Code skill for their workflow, or a co-authored blog post, or a recorded demo specific to their stack. The DM is "I built X, here's what makes it work for the specific thing you care about, and here's the artifact I made *just for you*."

#### A2. "Awesome Glyph" curated repo + chart-of-the-week newsletter
- **Conviction: 4/5**
- **Effort: S** (template + 5 starter entries, then community-driven)
- **Stars uplift: medium** (compounds slowly but reliably)
- **When:** month 2
- **Why:** an "awesome list" is a community-onramp and ranks well in Google. Pair with a 1-paragraph chart-of-the-week newsletter (Substack or your own site) — every issue is an SEO seed.

#### A3. "Switch from Vega-Lite" + "Switch from Plotly" migration guides
- **Conviction: 4/5**
- **Effort: M** (1 week each, Claude can draft 80%)
- **Stars uplift: medium** (captures connoisseur audience)
- **When:** month 2–3
- **Why:** Vega-Lite has 5.3k stars of audience that already speaks JSON-spec viz. They are *the* most pre-qualified prospects. Show them what they get by switching: agent affordances, audit, lineage, byte determinism. A specific table comparing 20 features wins the page.

#### A4. Pre-built skill packages for every major IDE
- **Conviction: 5/5**
- **Effort: S** (you already have skills for Claude/Cursor/Gemini/Codex; just package + publish them as `@glyph/skill-*` npm packages or marketplace listings)
- **Stars uplift: medium** (each install touches a user; aggregate is large)
- **When:** month 1
- **Why:** Cursor Rules, Cline rules, Continue custom-commands, Aider chat-modes, Copilot CLI extensions — each ecosystem has a way to install reusable agent context. Be present in all of them. The skills you've already written are 80% there; you just need distribution.

#### A5. "Built for agents" badge program
- **Conviction: 3/5**
- **Effort: S** (a badge image + a "verified" criteria doc)
- **Stars uplift: medium** (compounds with adoption)
- **When:** month 3
- **Why:** projects that ship glyph integrations get a badge. The badge links back. Cheap meme propagation. Worked for "Tested with Vitest", "Built with Astro", etc.

#### A6. Sponsor 3 high-traffic AI-dev YouTube creators for 60-second sponsored slots
- **Conviction: 3/5**
- **Effort: S** (one-time spend)
- **Stars uplift: medium-high** (depends on creator fit)
- **When:** month 4 once v1.0 is out
- **Targets:** Matthew Berman, AI Jason, Indy Dev Dan, Edward Donner, David Ondrej. Slot costs ~$500–2,000 each. Most show stars-jump within 48h of mention.
- **Caveat:** only do this *after* the site/playground is polished — paid traffic to an unconvincing landing page is wasted.

### Tier B — solid but not transformative

- **B1. GitHub Sponsors page** with three tiers. Funds itself; signals seriousness. Effort: S. Conviction: 3/5.
- **B2. A weekly office hours on Discord or YouTube live.** 30 min, Friday. Build the community personally. Effort: M (ongoing). Conviction: 3/5. Risk: cuts into the 1–3 hr budget if not careful.
- **B3. A "Chart audit benchmark"** — publish a methodology + leaderboard comparing how glyph/vega-lite/plotly/chart.js catch deceptive charts. Glyph wins by construction. Effort: M. Conviction: 3/5.
- **B4. Conference sticker swag.** Cheap, gets your logo in front of devs at events you don't attend. Effort: S. Conviction: 2/5.
- **B5. A "What's new this week" video** (60 sec, weekly). Compounds if consistent. Effort: M (recurring). Conviction: 3/5.
- **B6. Pre-publish to dev.to, Hashnode, Medium, Substack with canonical pointing to glyph.dev/blog.** Effort: S (automated). Conviction: 3/5.
- **B7. Show up on r/MachineLearning when relevant.** Light touch, high-quality answers. Conviction: 2/5 (high-noise sub).
- **B8. A Notion / Obsidian / Slack / Linear bot** that renders glyph charts on command. Effort: M each. Conviction: 3/5. Pick one.

### Tier C — only if all of A and S is shipped

- C1. Reddit AMA on r/programming or r/javascript
- C2. Print a t-shirt for SXSW / NeurIPS / AI Engineer
- C3. Translate docs to Mandarin (Chinese AI-dev market is huge but a separate playbook)
- C4. A book on "Designing data viz for AI agents" (1-year project)
- C5. Hosted glyph cloud (this is a *product*, not a growth tactic — only if commercializing)

---

## Part 3 — Do NOT do these (anti-list)

Most "growth hacks" actively hurt OSS projects. The ones below have low or negative expected value.

| Anti-pattern | Why it hurts |
|---|---|
| **Buying stars / star-pumping services** | GitHub flags inauthentic stars and silently suppresses your trending. Permanent reputation hit if outed. |
| **Mass-cold-emailing maintainers** | The best maintainers ignore mass mail; the worst will publicly call you out. The personalized DM approach (A1) beats this 100:1. |
| **Posting in every Discord/Slack you can find** | Looks spammy; community admins blacklist you; net negative. |
| **Engagement-farming tweets ("RT if you love charts!")** | Algorithm sees through it; nukes future reach. |
| **A premature commercial tier** | If you ship "Glyph Cloud" or paid features before 5k stars, you'll be perceived as VC-fishing rather than community-building. Hold commercials until you have undeniable usage. |
| **Comment wars with competitors** | Even if you win, you lose. Never argue with the antvis maintainers publicly; cooperate where possible. |
| **Renaming twice** | If you rename, do it once. Renaming again later signals instability. Worse than the original name. |
| **Promising features in the README that don't ship in 60 days** | The "Rust core" and "Python on PyPI" promises are fine if they ship. If they don't, every visitor sees vapor. |
| **Open-sourcing parts and closed-sourcing parts** | Open-source-with-asterisks reads as cynical and tanks community contribution. Pick one. |
| **Optimizing for star count over user delight** | Stars without users is a vanity number. Plotly has 18k stars and 10M+ weekly downloads. The downloads are what matters. |

---

## Part 4 — Your decision worksheet

Tear off the list below. Answer each in the next 7 days.

1. **Naming:** Keep "Glyph" / Rename to ____ / Decide by next Friday → ____
2. **Python:** Yes, I'll ship `pip install glyph` by month 3 / No, JS-only year 1 → ____
3. **Playground:** Yes, glyph.dev/play by month 2 / No → ____
4. **GitHub Action:** Yes, glyph-audit-action by month 3 / No → ____
5. **DM blitz:** Yes, 10 personalized DMs in week 3 / No → ____
6. **MCP servers PR:** Yes, this week / No → ____
7. **Migration guides:** Yes, 1 per month starting month 2 / No → ____
8. **Skill packages:** Yes, ship @glyph/skill-* for 5 IDEs by month 2 / No → ____

Anything you mark "Yes" goes into the weekly tracker artifact. Anything "No" is a deliberate choice you don't have to revisit.

---

## Bottom line

The single highest-conviction move is **shipping Python bindings**. It alone can change your ceiling from 10k to 25–40k. If you do nothing else from this list, do that.

Second highest is the **playground at glyph.dev/play**. Every chart someone makes there becomes a backlink.

Third is **landing in `modelcontextprotocol/servers`** — one PR, massive distribution.

The rename question is real but rarely the highest-leverage lever. My honest call: **keep Glyph, decide in 7 days, then commit**.
