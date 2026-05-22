/**
 * Math PR4 — `mark: "math-text"`.
 *
 * Renders a LaTeX expression as a positioned glyph group at the first
 * row's (encoding.x, encoding.y). Use cases: axis labels (`\sin(x)`),
 * titles (`y = e^{-x^2/2}`), and pointwise annotations.
 *
 * Spec shape:
 * ```json
 * {
 *   "mark": "math-text",
 *   "expr": "y = \\sin(x)",
 *   "fontSize": 14,
 *   "color": "#1a1a1a",
 *   "align": "middle",
 *   "encoding": {
 *     "x": { "field": "x", "type": "quantitative" },
 *     "y": { "field": "y", "type": "quantitative" }
 *   }
 * }
 * ```
 *
 * --- Pipeline ---
 * 1. `katex.renderToString(expr, { output: "mathml", throwOnError: false })`
 *    parses the LaTeX subset KaTeX supports and emits well-formed MathML.
 *    Compared to the HTML output, MathML is dramatically easier to consume
 *    from Node: it's a small set of elements (`mi`, `mo`, `mn`, `msup`,
 *    `msub`, `msubsup`, `mfrac`, `mrow`, plus PR6 — `msqrt`, `mroot`,
 *    `mover`, `munder`, `munderover`, `mtable`, `mtr`, `mtd`) and ships
 *    no CSS or font assumptions.
 * 2. A minimal recursive-descent walker over the MathML tokens produces
 *    a `MathBox` tree. Each box knows its (width, ascent, descent) in
 *    pixels AND its child positions. Layout uses a fixed-metrics table
 *    indexed by codepoint — IEEE-754 stable, platform-independent.
 * 3. Each leaf glyph emits one `<text>` SceneMark; each fraction emits
 *    one `<path>` SceneMark for the rule line. The existing SVG renderer
 *    consumes both, so output is fully self-contained — no client JS,
 *    no font dependency beyond the system serif fallback.
 *
 * --- Determinism gates ---
 *   - KaTeX's MathML output for a fixed input is stable across versions
 *     within a major (we pin ^0.16 in package.json). Test locks the
 *     bytes; an accidental upgrade that changes glyph order fails CI.
 *   - Layout metrics are a hardcoded table (no font-metric system probe).
 *   - All coordinates run through the existing `roundPx` rounding so
 *     subpixel drift can't leak in.
 *
 * --- v0 semantics ---
 *   - Renders the expression ONCE per layer, at the first row's (x, y).
 *     Row-multiplied rendering (one label per row, like the `text` mark)
 *     would surprise users who share a parent `data.function` between
 *     a curve layer and a math annotation — they'd see N overlapping
 *     copies. Multi-annotation lands when per-layer data overrides
 *     land; until then, callers add a second math-text layer for a
 *     second annotation.
 *
 * --- Known limitations (v0) ---
 *   - Supported MathML elements: mi, mo, mn, mtext, mspace, msup, msub,
 *     msubsup, mfrac, mrow, semantics (the `<annotation>` child is
 *     ignored — it's the round-trip TeX source). Math PR6 adds: msqrt,
 *     mroot, mover, munder, munderover, mtable, mtr, mtd.
 *   - Glyph advance widths are a coarse "narrow / wide / extra-wide"
 *     trichotomy, not real font metrics — readable but not typography.
 *   - The `align` knob anchors the whole expression's bounding box at
 *     the (x, y) pixel position. Within-box layout is always LTR.
 *   - The `√` glyph and matrix fence brackets `(`, `[`, `|` render at
 *     fixed em size — they do NOT stretch to match the radicand or
 *     matrix height. Stretching needs a multi-glyph stretchy-bracket
 *     font that's outside our deterministic-fallback scope.
 */
import katex from "katex";
import type { SceneMark } from "../../scenegraph/types.js";
import { type MarkCompileArgs, type MarkCompiler, registerMark } from "../mark-registry.js";
import { roundPx } from "../scales.js";

// ---------------------------------------------------------------------------
// Metrics — em-relative glyph widths + vertical extents.
// ---------------------------------------------------------------------------
//
// We deliberately don't probe the runtime font. Any font-aware metric makes
// the output drift across OS / browser / node version. Instead, we classify
// every glyph into a small set of width buckets and ship a fixed table.
// The result is "readable, not typeset". For agents using charts as data
// signals (axis labels, summary annotations), that's the right trade.

const NARROW_CHARS = new Set("ijlfrt.,:;'`!|()[]{}".split(""));
const EXTRA_WIDE_CHARS = new Set("MW%@".split(""));
const DIGIT_CHARS = new Set("0123456789".split(""));
const OP_CHARS = new Set("+-=<>≤≥≠≈±×÷·".split(""));
const BIG_OP_CHARS = new Set("∑∏∫".split(""));

function glyphWidthEm(ch: string): number {
  if (NARROW_CHARS.has(ch)) return 0.32;
  if (EXTRA_WIDE_CHARS.has(ch)) return 0.85;
  if (BIG_OP_CHARS.has(ch)) return 1.0;
  if (OP_CHARS.has(ch)) return 0.6;
  if (DIGIT_CHARS.has(ch)) return 0.55;
  // Default for ASCII letters + everything else — sized for readable serif.
  return 0.55;
}

/** Width of a glyph string in em (sum of per-char widths). */
function stringWidthEm(s: string): number {
  let w = 0;
  for (const ch of s) w += glyphWidthEm(ch);
  return w;
}

// ---------------------------------------------------------------------------
// MathML tokenizer — regex-driven, no JSDOM.
// ---------------------------------------------------------------------------
//
// KaTeX's MathML output is well-formed (no malformed tags, no comments,
// no nested CDATA) so we don't need a full XML parser. A token stream of
// open / close / text events drives a recursive-descent builder.

interface OpenTag {
  readonly kind: "open";
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly selfClose: boolean;
}
interface CloseTag {
  readonly kind: "close";
  readonly name: string;
}
interface TextNode {
  readonly kind: "text";
  readonly value: string;
}
type Token = OpenTag | CloseTag | TextNode;

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/)?>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tokenize(xml: string): Token[] {
  const out: Token[] = [];
  let cursor = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop.
  while ((m = TAG_RE.exec(xml)) !== null) {
    if (m.index > cursor) {
      const text = decodeEntities(xml.slice(cursor, m.index));
      if (text.length > 0) out.push({ kind: "text", value: text });
    }
    const raw = m[0];
    const name = m[1] ?? "";
    const attrsRaw = m[2] ?? "";
    const selfClose = m[3] === "/";
    if (raw.startsWith("</")) {
      out.push({ kind: "close", name });
    } else {
      const attrs: Record<string, string> = {};
      ATTR_RE.lastIndex = 0;
      let am: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop.
      while ((am = ATTR_RE.exec(attrsRaw)) !== null) {
        attrs[am[1] ?? ""] = am[2] ?? "";
      }
      out.push({ kind: "open", name, attrs, selfClose });
    }
    cursor = m.index + raw.length;
  }
  if (cursor < xml.length) {
    const text = decodeEntities(xml.slice(cursor));
    if (text.length > 0) out.push({ kind: "text", value: text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// MathML AST.
// ---------------------------------------------------------------------------

type MNode =
  /** A leaf glyph: <mi>, <mo>, <mn>, <mtext>. */
  | { readonly kind: "glyph"; readonly text: string }
  /** Horizontal concatenation of children. */
  | { readonly kind: "row"; readonly children: ReadonlyArray<MNode> }
  /** Superscript: base with raised exponent. */
  | { readonly kind: "sup"; readonly base: MNode; readonly sup: MNode }
  /** Subscript: base with lowered argument. */
  | { readonly kind: "sub"; readonly base: MNode; readonly sub: MNode }
  /** Both. */
  | {
      readonly kind: "subsup";
      readonly base: MNode;
      readonly sub: MNode;
      readonly sup: MNode;
    }
  /** Fraction: numerator over denominator with a rule line. */
  | { readonly kind: "frac"; readonly num: MNode; readonly den: MNode }
  /**
   * Square root or nth root.
   * `index` is `undefined` for plain `\sqrt{...}` (msqrt) and present for
   * `\sqrt[n]{...}` (mroot). Renders as a `√` glyph + horizontal overbar
   * spanning the radicand, with the optional small index above-left.
   */
  | {
      readonly kind: "sqrt";
      readonly radicand: MNode;
      readonly index: MNode | undefined;
    }
  /**
   * Accent (`<mover accent="true">`): small mark centered above the base
   * — `\hat`, `\bar`, `\vec`. Distinguished from stacked-limit `<mover>`
   * by the `accent="true"` attribute KaTeX sets.
   */
  | { readonly kind: "accent"; readonly base: MNode; readonly accent: MNode }
  /**
   * Stacked-limit `<munder>` / `<mover>` / `<munderover>` (non-accent).
   * `sub`/`sup` are `undefined` when the source element didn't supply
   * that slot. The base operator gets the limits stacked vertically
   * (sub below, sup above) and centered horizontally.
   */
  | {
      readonly kind: "limits";
      readonly base: MNode;
      readonly sub: MNode | undefined;
      readonly sup: MNode | undefined;
    }
  /**
   * Matrix table: a rectangular grid of cells. Cell widths are sized by
   * the max width within each column; row heights by the max
   * (ascent + descent) within each row. v0 does not stretch the
   * surrounding fence brackets to match the matrix height.
   */
  | { readonly kind: "table"; readonly rows: ReadonlyArray<ReadonlyArray<MNode>> };

const EMPTY_ROW: MNode = { kind: "row", children: [] };

/** Glyphs that should trigger STACKED (rather than side-set) sub/super layout
 * when used as the base of `<msub>`/`<msup>`/`<msubsup>`. KaTeX emits these
 * in inline mode for `\sum_{i=1}^n`, `\lim_{x \to 0}`, etc. — even though
 * the visually-correct rendering is `<munderover>`-style stacking. We
 * detect the operator glyph and stack it ourselves. */
const STACKED_OP_GLYPHS = new Set([
  "∑",
  "∏",
  "∫",
  "∮",
  "∐",
  "⋃",
  "⋂",
  "⨁",
  "⨂",
  "⨄",
  "⨆",
  "lim",
  "max",
  "min",
  "sup",
  "inf",
  "det",
  "arg",
  "gcd",
  "liminf",
  "limsup",
]);

/** True iff `node` is a single glyph (or singleton row) whose text is a stacked-op. */
function isStackedOpBase(node: MNode): boolean {
  if (node.kind === "glyph") return STACKED_OP_GLYPHS.has(node.text);
  if (node.kind === "row" && node.children.length === 1) {
    const c = node.children[0];
    if (c) return isStackedOpBase(c);
  }
  return false;
}

/**
 * MathML elements we render with dedicated layout. Anything outside this set
 * triggers `warnUnknownMathmlOnce` (one warning per element name across the
 * process lifetime). Keep in sync with the `parseElement` switch — adding a
 * case there without adding the name here is fine (extra entries are just
 * not-warned), but adding a name here without a case is misleading.
 */
const SUPPORTED_MATHML = new Set([
  "mi",
  "mo",
  "mn",
  "mtext",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "mrow",
  "math",
  "semantics",
  "annotation",
  "mspace",
  // Math PR6 — radicals, accents, stacked limits, matrices.
  "msqrt",
  "mroot",
  "mover",
  "munder",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  // KaTeX wraps matrix cell content in <mstyle scriptlevel="0" displaystyle="false">
  // — semantically transparent to layout, so we treat it as a passthrough row.
  // The mstyle attributes (scriptlevel, displaystyle, mathcolor, …) are
  // intentionally dropped today; if KaTeX ever emits a style we can't ignore,
  // the parser's default-branch will route the element through parseSequence
  // and the existing structure renders.
  "mstyle",
  // KaTeX with `forMathmlOnly: true` wraps the entire <math> tree in
  // <span class="katex">. Pure styling sugar — no semantic layout
  // implications. Allowlisting silences the one-shot warning on every
  // fresh-process compile.
  "span",
]);

/**
 * Module-local set of MathML element names we've already warned about — keeps
 * a chart with 100 `\sqrt` instances from logging 100 times. Reset never
 * happens within a process; that's intentional (logging once per session is
 * the desired UX).
 */
const _warnedMathml = new Set<string>();
function warnUnknownMathmlOnce(name: string): void {
  if (SUPPORTED_MATHML.has(name) || _warnedMathml.has(name)) return;
  _warnedMathml.add(name);
  console.warn(
    `[glyph] math-text: MathML element <${name}> is not yet rendered with dedicated layout. Its child content will appear inline. Supported: ${[...SUPPORTED_MATHML].join(", ")}. If you need <${name}>, please file an issue.`,
  );
}

/** A streaming parser over the token list. Advances `i` in-place. */
class MParser {
  private i = 0;
  constructor(private readonly tokens: ReadonlyArray<Token>) {}

  parse(): MNode {
    return this.parseSequence("__root__");
  }

  /** Consume tokens until `</closeName>` or end of stream. */
  private parseSequence(closeName: string): MNode {
    const kids: MNode[] = [];
    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i];
      if (!t) break;
      if (t.kind === "close") {
        if (t.name === closeName) {
          this.i++;
          break;
        }
        // Stray close — skip.
        this.i++;
        continue;
      }
      if (t.kind === "text") {
        // Text only matters inside leaf elements (mi/mo/mn/mtext). At
        // sequence level it's whitespace between siblings — ignored.
        this.i++;
        continue;
      }
      // Open tag.
      const node = this.parseElement(t);
      if (node) kids.push(node);
    }
    if (kids.length === 1) return kids[0] ?? EMPTY_ROW;
    return { kind: "row", children: kids };
  }

  /** `t` is the current `open` token; consume it + its children + close. */
  private parseElement(t: OpenTag): MNode | undefined {
    this.i++;
    const name = t.name;
    if (t.selfClose) {
      // mspace is the common self-closing tag; render as zero width.
      return EMPTY_ROW;
    }
    switch (name) {
      case "mi":
      case "mo":
      case "mn":
      case "mtext": {
        // Collect adjacent text until the matching close.
        let text = "";
        while (this.i < this.tokens.length) {
          const c = this.tokens[this.i];
          if (!c) break;
          if (c.kind === "close" && c.name === name) {
            this.i++;
            break;
          }
          if (c.kind === "text") {
            text += c.value;
            this.i++;
            continue;
          }
          if (c.kind === "open") {
            this.parseElement(c);
            continue;
          }
          this.i++;
        }
        if (text.length === 0) return undefined;
        // Strip invisible MathML operators: U+2061 (function application),
        // U+2062 (invisible times), U+2063 (invisible separator),
        // U+2064 (invisible plus). KaTeX emits these as `<mo>` after
        // function names like `\sin`; they convey semantic info to MathML
        // readers but contribute nothing visual and would only consume
        // (zero) width in our metrics, adding noise to the SVG. Drop
        // when the entire glyph string is one of these codepoints.
        if (/^[⁡-⁤]+$/.test(text)) return undefined;
        return { kind: "glyph", text };
      }
      case "msup": {
        const a = this.takeArg();
        const b = this.takeArg();
        this.expectClose(name);
        return { kind: "sup", base: a, sup: b };
      }
      case "msub": {
        const a = this.takeArg();
        const b = this.takeArg();
        this.expectClose(name);
        return { kind: "sub", base: a, sub: b };
      }
      case "msubsup": {
        const a = this.takeArg();
        const b = this.takeArg();
        const c = this.takeArg();
        this.expectClose(name);
        return { kind: "subsup", base: a, sub: b, sup: c };
      }
      case "mfrac": {
        const a = this.takeArg();
        const b = this.takeArg();
        this.expectClose(name);
        return { kind: "frac", num: a, den: b };
      }
      case "msqrt": {
        // `<msqrt>` is a sequence of children that form the radicand.
        const radicand = this.parseSequence(name);
        return { kind: "sqrt", radicand, index: undefined };
      }
      case "mroot": {
        // `<mroot>` has exactly two children: radicand FIRST, index SECOND.
        const radicand = this.takeArg();
        const index = this.takeArg();
        this.expectClose(name);
        return { kind: "sqrt", radicand, index };
      }
      case "mover": {
        // accent="true" → small mark centered above the base. Otherwise
        // → stacked limit (mover on a big-op base in display style).
        const base = this.takeArg();
        const upper = this.takeArg();
        this.expectClose(name);
        if (t.attrs.accent === "true") {
          return { kind: "accent", base, accent: upper };
        }
        return { kind: "limits", base, sub: undefined, sup: upper };
      }
      case "munder": {
        const base = this.takeArg();
        const lower = this.takeArg();
        this.expectClose(name);
        // KaTeX sets accentunder="true" for underline-style accents; we
        // treat those identically to overaccents for v0 (rare in practice).
        if (t.attrs.accent === "true" || t.attrs.accentunder === "true") {
          return { kind: "accent", base, accent: lower };
        }
        return { kind: "limits", base, sub: lower, sup: undefined };
      }
      case "munderover": {
        const base = this.takeArg();
        const lower = this.takeArg();
        const upper = this.takeArg();
        this.expectClose(name);
        return { kind: "limits", base, sub: lower, sup: upper };
      }
      case "mtable": {
        // Parse rows. A direct child <mtr> is one row of cells.
        const rows: Array<ReadonlyArray<MNode>> = [];
        while (this.i < this.tokens.length) {
          const c = this.tokens[this.i];
          if (!c) break;
          if (c.kind === "close" && c.name === name) {
            this.i++;
            break;
          }
          if (c.kind === "open" && c.name === "mtr") {
            this.i++;
            const cells: MNode[] = [];
            while (this.i < this.tokens.length) {
              const cc = this.tokens[this.i];
              if (!cc) break;
              if (cc.kind === "close" && cc.name === "mtr") {
                this.i++;
                break;
              }
              if (cc.kind === "open" && cc.name === "mtd") {
                this.i++;
                cells.push(this.parseSequence("mtd"));
                continue;
              }
              // Stray content inside <mtr> — skip.
              this.i++;
            }
            rows.push(cells);
            continue;
          }
          // Stray content directly inside <mtable> — skip.
          this.i++;
        }
        return { kind: "table", rows };
      }
      case "mstyle":
      case "mrow":
      case "math":
      case "semantics": {
        return this.parseSequence(name);
      }
      case "annotation": {
        // Round-trip LaTeX source — not visual content. Skip body.
        this.skipUntilClose(name);
        return undefined;
      }
      case "mspace": {
        this.skipUntilClose(name);
        return EMPTY_ROW;
      }
      default: {
        // Math PR4 review BLOCKER-B2 — log a one-shot warning naming the
        // unknown element so the caller can tell `\sqrt{x+1}` rendered as
        // bare `x+1` (no radical) instead of silently dropping the
        // structural info. Recurse anyway so simple text content still
        // appears. Dedup via a module-level Set so a chart with 100
        // `\sqrt` instances logs once, not 100 times.
        warnUnknownMathmlOnce(name);
        return this.parseSequence(name);
      }
    }
  }

  /** Take exactly one child node — the next element in the stream. */
  private takeArg(): MNode {
    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i];
      if (!t) break;
      if (t.kind === "close") return EMPTY_ROW;
      if (t.kind === "text") {
        this.i++;
        continue;
      }
      const node = this.parseElement(t);
      return node ?? EMPTY_ROW;
    }
    return EMPTY_ROW;
  }

  private expectClose(name: string): void {
    while (this.i < this.tokens.length) {
      const t = this.tokens[this.i];
      if (!t) break;
      if (t.kind === "close") {
        this.i++;
        if (t.name === name) return;
        return;
      }
      this.i++;
    }
  }

  private skipUntilClose(name: string): void {
    let depth = 1;
    while (this.i < this.tokens.length && depth > 0) {
      const t = this.tokens[this.i++];
      if (!t) break;
      if (t.kind === "open" && t.name === name && !t.selfClose) depth++;
      else if (t.kind === "close" && t.name === name) depth--;
    }
  }
}

// ---------------------------------------------------------------------------
// Layout — assign (x, y) in pixels to each glyph.
// ---------------------------------------------------------------------------

interface MathBox {
  /** Pixel width. */
  readonly width: number;
  /** Distance from baseline to top (positive). */
  readonly ascent: number;
  /** Distance from baseline to bottom (positive). */
  readonly descent: number;
  readonly glyphs: ReadonlyArray<GlyphPos>;
  readonly rules: ReadonlyArray<RulePos>;
}
interface GlyphPos {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly fontSize: number;
}
interface RulePos {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

const SUP_SCALE = 0.7;
const SUB_SCALE = 0.7;
const SUP_RAISE = 0.45; // em
const SUB_DROP = 0.2; // em
const FRAC_GAP = 0.15; // em above/below the rule line
const RULE_THICKNESS = 0.06; // em

// --- Math PR6 — new layout constants ---
//
// All values are em-relative, hand-tuned for visual balance at 22px (the
// default fixture font size). The exact constants are part of the
// determinism contract: changing one shifts every snapshot.
const SQRT_GAP = 0.1; // gap between √ glyph and overbar / radicand
const SQRT_BAR_THICKNESS = 0.06; // overbar stroke width as em fraction
const SQRT_PADDING = 0.1; // horizontal padding inside radical
const ROOT_INDEX_SCALE = 0.55; // size of the nth-root index (slightly smaller than sup)
const ROOT_INDEX_RAISE = 0.6; // em — how high above baseline the index sits
const ACCENT_SCALE = 0.7; // accent glyph scaling
const ACCENT_RAISE = 0.6; // em — accent vertical offset above base ascent
const LIMITS_SCALE = 0.7; // stacked sub/sup scaling
const LIMITS_GAP = 0.1; // em — vertical gap between operator and limit
const TABLE_COL_GAP = 0.6; // em — column-to-column spacing
const TABLE_ROW_GAP = 0.3; // em — extra padding between rows

/** Layout one MathML AST node at the given pixel em size. */
function layoutNode(node: MNode, em: number): MathBox {
  switch (node.kind) {
    case "glyph": {
      const w = stringWidthEm(node.text) * em;
      return {
        width: w,
        ascent: em * 0.75,
        descent: em * 0.25,
        glyphs: [{ x: 0, y: 0, text: node.text, fontSize: em }],
        rules: [],
      };
    }
    case "row": {
      let x = 0;
      let ascent = 0;
      let descent = 0;
      const glyphs: GlyphPos[] = [];
      const rules: RulePos[] = [];
      for (const child of node.children) {
        const box = layoutNode(child, em);
        for (const g of box.glyphs) glyphs.push({ ...g, x: g.x + x });
        for (const r of box.rules) rules.push({ ...r, x: r.x + x });
        x += box.width;
        if (box.ascent > ascent) ascent = box.ascent;
        if (box.descent > descent) descent = box.descent;
      }
      return { width: x, ascent, descent, glyphs, rules };
    }
    case "sup": {
      // PR6 — for big operators (∑, ∏, ∫, lim, …) KaTeX emits <msup> but
      // the visually-correct layout is stacked (sup above the operator).
      // Detect and reroute to the limits layout.
      if (isStackedOpBase(node.base)) {
        return layoutLimits(node.base, undefined, node.sup, em);
      }
      const base = layoutNode(node.base, em);
      const sup = layoutNode(node.sup, em * SUP_SCALE);
      const supX = base.width;
      const supY = -em * SUP_RAISE;
      const glyphs: GlyphPos[] = [
        ...base.glyphs,
        ...sup.glyphs.map((g) => ({ ...g, x: g.x + supX, y: g.y + supY })),
      ];
      const rules: RulePos[] = [
        ...base.rules,
        ...sup.rules.map((r) => ({ ...r, x: r.x + supX, y: r.y + supY })),
      ];
      const width = supX + sup.width;
      const ascent = Math.max(base.ascent, -supY + sup.ascent);
      return { width, ascent, descent: base.descent, glyphs, rules };
    }
    case "sub": {
      // PR6 — same big-op reroute as sup. Notably, `\lim_{x \to 0}` lowers
      // to <msub> in inline mode and should still stack the limit below.
      if (isStackedOpBase(node.base)) {
        return layoutLimits(node.base, node.sub, undefined, em);
      }
      const base = layoutNode(node.base, em);
      const sub = layoutNode(node.sub, em * SUB_SCALE);
      const subX = base.width;
      const subY = em * SUB_DROP;
      const glyphs: GlyphPos[] = [
        ...base.glyphs,
        ...sub.glyphs.map((g) => ({ ...g, x: g.x + subX, y: g.y + subY })),
      ];
      const rules: RulePos[] = [
        ...base.rules,
        ...sub.rules.map((r) => ({ ...r, x: r.x + subX, y: r.y + subY })),
      ];
      const width = subX + sub.width;
      const descent = Math.max(base.descent, subY + sub.descent);
      return { width, ascent: base.ascent, descent, glyphs, rules };
    }
    case "subsup": {
      // PR6 — same big-op reroute.
      if (isStackedOpBase(node.base)) {
        return layoutLimits(node.base, node.sub, node.sup, em);
      }
      const base = layoutNode(node.base, em);
      const sub = layoutNode(node.sub, em * SUB_SCALE);
      const sup = layoutNode(node.sup, em * SUP_SCALE);
      const argX = base.width;
      const supY = -em * SUP_RAISE;
      const subY = em * SUB_DROP;
      const glyphs: GlyphPos[] = [
        ...base.glyphs,
        ...sub.glyphs.map((g) => ({ ...g, x: g.x + argX, y: g.y + subY })),
        ...sup.glyphs.map((g) => ({ ...g, x: g.x + argX, y: g.y + supY })),
      ];
      const rules: RulePos[] = [
        ...base.rules,
        ...sub.rules.map((r) => ({ ...r, x: r.x + argX, y: r.y + subY })),
        ...sup.rules.map((r) => ({ ...r, x: r.x + argX, y: r.y + supY })),
      ];
      const width = argX + Math.max(sub.width, sup.width);
      const ascent = Math.max(base.ascent, -supY + sup.ascent);
      const descent = Math.max(base.descent, subY + sub.descent);
      return { width, ascent, descent, glyphs, rules };
    }
    case "frac": {
      const num = layoutNode(node.num, em);
      const den = layoutNode(node.den, em);
      const width = Math.max(num.width, den.width);
      const gap = em * FRAC_GAP;
      const ruleY = -em * 0.25;
      const numY = ruleY - gap - num.descent;
      const denY = ruleY + gap + den.ascent;
      const numX = (width - num.width) / 2;
      const denX = (width - den.width) / 2;
      const glyphs: GlyphPos[] = [
        ...num.glyphs.map((g) => ({ ...g, x: g.x + numX, y: g.y + numY })),
        ...den.glyphs.map((g) => ({ ...g, x: g.x + denX, y: g.y + denY })),
      ];
      const rules: RulePos[] = [
        ...num.rules.map((r) => ({ ...r, x: r.x + numX, y: r.y + numY })),
        ...den.rules.map((r) => ({ ...r, x: r.x + denX, y: r.y + denY })),
        { x: 0, y: ruleY, width },
      ];
      const ascent = -numY + num.ascent;
      const descent = denY + den.descent;
      return { width, ascent, descent, glyphs, rules };
    }
    case "sqrt":
      return layoutSqrt(node.radicand, node.index, em);
    case "accent":
      return layoutAccent(node.base, node.accent, em);
    case "limits":
      return layoutLimits(node.base, node.sub, node.sup, em);
    case "table":
      return layoutTable(node.rows, em);
  }
}

// --- Math PR6 — extracted layout helpers ---

/**
 * Square root (`<msqrt>`) and nth root (`<mroot>`).
 *
 * Geometry:
 * ```
 *      ____________
 *  ³√  x² + 1
 *  ^   ^^^^^^^^^^^
 *  |   radicand (laid out at full em)
 *  └── √ glyph (height = radicand ascent + descent + gap), with the
 *      index "³" raised above-left
 * ```
 * The overbar is a horizontal rule line at `-(radicand.ascent + gap)`.
 * The `√` glyph sits at the baseline as a normal text glyph; we don't
 * stretch it to match the radicand height (would need a stretchy-glyph
 * font, not available in our deterministic-fallback world).
 */
function layoutSqrt(radicand: MNode, index: MNode | undefined, em: number): MathBox {
  const rad = layoutNode(radicand, em);
  const gap = em * SQRT_GAP;
  const pad = em * SQRT_PADDING;
  const radicalText = "√";
  const radicalW = stringWidthEm(radicalText) * em;
  const barThickness = Math.max(1, em * SQRT_BAR_THICKNESS);

  // Lay out the index (if any) first so we know how far right the radical
  // shifts. The index sits at x ∈ [0, idx.width) and y above baseline.
  const idxBox = index === undefined ? undefined : layoutNode(index, em * ROOT_INDEX_SCALE);
  const indexY = -em * ROOT_INDEX_RAISE;
  const indexOff = idxBox === undefined ? 0 : idxBox.width;

  // Radical glyph at (indexOff, 0). Overbar starts where the radical ends,
  // spans the full padded radicand. Radicand at (indexOff + radicalW + pad/2).
  const radicalX = indexOff;
  const barX = indexOff + radicalW;
  const barWidth = rad.width + pad;
  const barY = -(rad.ascent + gap);
  const radX = indexOff + radicalW + pad / 2;

  const glyphs: GlyphPos[] = [];
  const rules: RulePos[] = [];
  if (idxBox !== undefined) {
    for (const g of idxBox.glyphs) glyphs.push({ ...g, x: g.x, y: g.y + indexY });
    for (const r of idxBox.rules) rules.push({ ...r, x: r.x, y: r.y + indexY });
  }
  glyphs.push({ x: radicalX, y: 0, text: radicalText, fontSize: em });
  for (const g of rad.glyphs) glyphs.push({ ...g, x: g.x + radX, y: g.y });
  for (const r of rad.rules) rules.push({ ...r, x: r.x + radX, y: r.y });
  rules.push({ x: barX, y: barY, width: barWidth });

  const width = indexOff + radicalW + rad.width + pad;
  const indexAscent = idxBox === undefined ? 0 : -indexY + idxBox.ascent;
  const ascent = Math.max(rad.ascent + gap + barThickness, indexAscent);
  const descent = rad.descent;
  return { width, ascent, descent, glyphs, rules };
}

/**
 * Accent (`<mover accent="true">`): `\hat`, `\bar`, `\vec`, `\tilde`, …
 *
 * The accent glyph is centered horizontally over the base and raised
 * by `ACCENT_RAISE` em above the baseline (independent of base height
 * — accents are typographic marks, not stacked content).
 */
function layoutAccent(base: MNode, accent: MNode, em: number): MathBox {
  const baseBox = layoutNode(base, em);
  const accentBox = layoutNode(accent, em * ACCENT_SCALE);
  // Center the accent over the base by (baseWidth - accentWidth) / 2.
  const accentX = (baseBox.width - accentBox.width) / 2;
  const accentY = -em * ACCENT_RAISE;
  const glyphs: GlyphPos[] = [
    ...baseBox.glyphs,
    ...accentBox.glyphs.map((g) => ({ ...g, x: g.x + accentX, y: g.y + accentY })),
  ];
  const rules: RulePos[] = [
    ...baseBox.rules,
    ...accentBox.rules.map((r) => ({ ...r, x: r.x + accentX, y: r.y + accentY })),
  ];
  const ascent = Math.max(baseBox.ascent, -accentY + accentBox.ascent);
  return { width: baseBox.width, ascent, descent: baseBox.descent, glyphs, rules };
}

/**
 * Stacked limits: sub (optional) below the base, sup (optional) above.
 * Used by `<munder>`, `<mover>`, `<munderover>`, AND by `<msub>`/
 * `<msup>`/`<msubsup>` when the base is a recognized big operator
 * (sum, prod, int, lim, max, min, …).
 *
 * Layout:
 * ```
 *       n
 *       ∑      (base centered in the wider of sup/sub)
 *      i=1
 * ```
 * The widest of `{base, sub, sup}` determines the total width;
 * each row is then centered horizontally within that width.
 */
function layoutLimits(
  base: MNode,
  sub: MNode | undefined,
  sup: MNode | undefined,
  em: number,
): MathBox {
  const baseBox = layoutNode(base, em);
  const subBox = sub === undefined ? undefined : layoutNode(sub, em * LIMITS_SCALE);
  const supBox = sup === undefined ? undefined : layoutNode(sup, em * LIMITS_SCALE);
  const width = Math.max(
    baseBox.width,
    subBox === undefined ? 0 : subBox.width,
    supBox === undefined ? 0 : supBox.width,
  );
  const gap = em * LIMITS_GAP;
  const baseX = (width - baseBox.width) / 2;
  const glyphs: GlyphPos[] = baseBox.glyphs.map((g) => ({ ...g, x: g.x + baseX }));
  const rules: RulePos[] = baseBox.rules.map((r) => ({ ...r, x: r.x + baseX }));
  let ascent = baseBox.ascent;
  let descent = baseBox.descent;
  if (supBox !== undefined) {
    const supX = (width - supBox.width) / 2;
    const supY = -(baseBox.ascent + gap + supBox.descent);
    for (const g of supBox.glyphs) glyphs.push({ ...g, x: g.x + supX, y: g.y + supY });
    for (const r of supBox.rules) rules.push({ ...r, x: r.x + supX, y: r.y + supY });
    ascent = Math.max(ascent, -supY + supBox.ascent);
  }
  if (subBox !== undefined) {
    const subX = (width - subBox.width) / 2;
    const subY = baseBox.descent + gap + subBox.ascent;
    for (const g of subBox.glyphs) glyphs.push({ ...g, x: g.x + subX, y: g.y + subY });
    for (const r of subBox.rules) rules.push({ ...r, x: r.x + subX, y: r.y + subY });
    descent = Math.max(descent, subY + subBox.descent);
  }
  return { width, ascent, descent, glyphs, rules };
}

/**
 * Matrix table (`<mtable>` rows of `<mtr>` of `<mtd>`).
 *
 * - Column widths sized to widest cell in each column (after layout).
 * - Row heights uniform-per-row: max of (ascent + descent) across cells.
 * - Each cell centered horizontally within its column; vertically
 *   anchored at row baseline.
 * - Column gap `TABLE_COL_GAP`, row gap `TABLE_ROW_GAP` (em).
 *
 * v0 does NOT stretch the surrounding fence brackets `(...)` / `[...]`
 * to match the matrix height — they render at their normal size and
 * sit at the matrix baseline. See class doc-comment for the rationale
 * (no stretchy-glyph font in our deterministic fallback).
 */
function layoutTable(rows: ReadonlyArray<ReadonlyArray<MNode>>, em: number): MathBox {
  if (rows.length === 0) {
    return { width: 0, ascent: em * 0.75, descent: em * 0.25, glyphs: [], rules: [] };
  }
  // Lay out every cell once so we know widths/heights.
  const ncols = Math.max(0, ...rows.map((r) => r.length));
  const cellBoxes: MathBox[][] = rows.map((r) =>
    r
      .map((c) => layoutNode(c, em))
      .concat(
        // Pad short rows with empty boxes so columns still align.
        Array.from({ length: ncols - r.length }, () => layoutNode(EMPTY_ROW, em)),
      ),
  );
  // Column widths = max cell width per column.
  const colWidths: number[] = [];
  for (let c = 0; c < ncols; c++) {
    let w = 0;
    for (let r = 0; r < cellBoxes.length; r++) {
      const cell = cellBoxes[r]?.[c];
      if (cell && cell.width > w) w = cell.width;
    }
    colWidths.push(w);
  }
  // Row heights = max (ascent + descent) per row.
  const rowHeights: number[] = cellBoxes.map((row) =>
    row.reduce((max, cell) => Math.max(max, cell.ascent + cell.descent), 0),
  );
  const colGap = em * TABLE_COL_GAP;
  const rowGap = em * TABLE_ROW_GAP;
  // Total width = sum of col widths + (ncols-1) gaps.
  const totalWidth = colWidths.reduce((s, w) => s + w, 0) + colGap * Math.max(0, ncols - 1);
  // Total height = sum of row heights + (nrows-1) row gaps.
  const totalHeight = rowHeights.reduce((s, h) => s + h, 0) + rowGap * Math.max(0, rows.length - 1);
  // Anchor: center the matrix vertically on the math axis. Ascent = top
  // half above baseline, descent = bottom half below.
  const ascent = totalHeight / 2;
  const descent = totalHeight / 2;
  const glyphs: GlyphPos[] = [];
  const rules: RulePos[] = [];
  // Top of the matrix relative to baseline:
  let yCursor = -ascent;
  for (let r = 0; r < cellBoxes.length; r++) {
    const row = cellBoxes[r];
    const rowH = rowHeights[r] ?? 0;
    let xCursor = 0;
    for (let c = 0; c < ncols; c++) {
      const cell = row?.[c];
      const colW = colWidths[c] ?? 0;
      if (cell) {
        const dx = xCursor + (colW - cell.width) / 2;
        // Vertically center the cell within its row band.
        const cellTotalH = cell.ascent + cell.descent;
        const dy = yCursor + (rowH - cellTotalH) / 2 + cell.ascent;
        for (const g of cell.glyphs) glyphs.push({ ...g, x: g.x + dx, y: g.y + dy });
        for (const rl of cell.rules) rules.push({ ...rl, x: rl.x + dx, y: rl.y + dy });
      }
      xCursor += colW + colGap;
    }
    yCursor += rowH + rowGap;
  }
  return { width: totalWidth, ascent, descent, glyphs, rules };
}

// ---------------------------------------------------------------------------
// Spec extraction helpers.
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

interface MathTextOptions {
  readonly expr: string;
  readonly fontSize: number;
  readonly color: string;
  readonly align: "start" | "middle" | "end";
  /** Explicit data-space anchor; overrides row-based positioning. */
  readonly at: { readonly x: number; readonly y: number } | undefined;
}

function readOptions(layer: unknown, themeFg: string): MathTextOptions | undefined {
  if (typeof layer !== "object" || layer === null) return undefined;
  const l = layer as Record<string, unknown>;
  const expr = typeof l.expr === "string" ? l.expr : undefined;
  if (!expr) return undefined;
  const fontSize = typeof l.fontSize === "number" && l.fontSize > 0 ? l.fontSize : 14;
  const color = typeof l.color === "string" ? l.color : themeFg;
  const alignRaw = typeof l.align === "string" ? l.align : "middle";
  const align: "start" | "middle" | "end" =
    alignRaw === "start" || alignRaw === "end" ? alignRaw : "middle";
  let at: { x: number; y: number } | undefined;
  if (typeof l.at === "object" && l.at !== null) {
    const a = l.at as { x?: unknown; y?: unknown };
    if (typeof a.x === "number" && typeof a.y === "number") {
      if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
        at = { x: a.x, y: a.y };
      }
    }
  }
  return { expr, fontSize, color, align, at };
}

// ---------------------------------------------------------------------------
// Mark compiler entry point.
// ---------------------------------------------------------------------------

export const mathTextMarkCompiler: MarkCompiler = {
  type: "math-text",
  compile(args: MarkCompileArgs): void {
    const { xScale, yScale, rows, schema, theme, out, layer } = args;
    if (!yScale) return;
    if (xScale.type !== "linear") {
      // math-text positions on a continuous (x, y); band scales make no
      // physical sense for inline annotations.
      return;
    }
    const opts = readOptions(layer, theme.fg);
    if (!opts) return;

    // KaTeX parse → MathML string. throwOnError=false so malformed
    // LaTeX renders as red error text (KaTeX's default) instead of
    // tanking the entire compile.
    const mathml = katex.renderToString(opts.expr, {
      output: "mathml",
      throwOnError: false,
    });
    const tokens = tokenize(mathml);
    const ast = new MParser(tokens).parse();
    const box = layoutNode(ast, opts.fontSize);

    // Anchor offset for the requested alignment. The bounding box's
    // left edge sits at the row's (x, y) by default; "middle" shifts it
    // left by half the box width; "end" by the full width.
    const anchorDx =
      opts.align === "start" ? 0 : opts.align === "end" ? -box.width : -box.width / 2;

    // Pick the data-space anchor. `layer.at` (explicit) wins over the
    // first row's (x, y) — that's the canonical path for fixed titles
    // and axis labels. Row-based positioning is the fallback when `at`
    // is absent.
    let xv: number;
    let yv: number;
    if (opts.at) {
      xv = opts.at.x;
      yv = opts.at.y;
    } else {
      // Math PR4 review IMPORTANT-2 — surface a real error when the
      // encoding-x/y fields aren't in the schema. The previous version
      // silently returned, leaving the user staring at a math-text
      // layer that emitted nothing with zero diagnostic. compile.ts's
      // validation gate confirms the encoding is SET; this confirms
      // the named field actually exists.
      if (!args.xField || !args.yField) {
        throw new Error(
          "math-text: missing 'at' anchor and no encoding.x/encoding.y set " +
            "(compile.ts validation gate should have caught this earlier).",
        );
      }
      const xIdx = schema.findIndex((c) => c.name === args.xField);
      const yIdx = schema.findIndex((c) => c.name === args.yField);
      if (xIdx < 0 || yIdx < 0) {
        throw new Error(
          `math-text: encoding.x="${args.xField}" or encoding.y="${args.yField}" not found in schema (got: ${schema.map((c) => c.name).join(", ")}). Either fix the field names or set 'at: { x, y }' for fixed positioning.`,
        );
      }
      const firstRow = rows[0];
      if (!firstRow) return;
      xv = num(firstRow[xIdx]);
      yv = num(firstRow[yIdx]);
    }
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) return;
    const xpx = xScale.apply(xv);
    const ypx = yScale.apply(yv);
    if (!Number.isFinite(xpx) || !Number.isFinite(ypx)) return;

    emitBox(out, box, xpx, ypx, anchorDx, opts);
  },
};

/** Push the laid-out glyph + rule marks into the scene at (xpx, ypx). */
function emitBox(
  out: SceneMark[],
  box: MathBox,
  xpx: number,
  ypx: number,
  anchorDx: number,
  opts: MathTextOptions,
): void {
  for (const g of box.glyphs) {
    const tx = roundPx(xpx + anchorDx + g.x);
    const ty = roundPx(ypx + g.y);
    out.push({
      type: "text",
      x: tx,
      y: ty,
      text: g.text,
      fontSize: roundPx(g.fontSize),
      fill: opts.color,
      anchor: "start",
      // alphabetic baseline so y coords align with typeset math axes.
      baseline: "alphabetic",
    });
  }
  for (const r of box.rules) {
    const x1 = roundPx(xpx + anchorDx + r.x);
    const x2 = roundPx(xpx + anchorDx + r.x + r.width);
    const y = roundPx(ypx + r.y);
    const thickness = Math.max(1, roundPx(opts.fontSize * RULE_THICKNESS));
    out.push({
      type: "path",
      d: `M ${x1} ${y} L ${x2} ${y}`,
      stroke: opts.color,
      strokeWidth: thickness,
    });
  }
}

registerMark(mathTextMarkCompiler);
