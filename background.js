const ROOT_FOLDER = "UXRay";
const EXTENSION_VERSION = "2.0.0";

/* ------------------------------------------------------------------ *
 * In-page analyzer.
 * This whole function is serialized and injected into the target page
 * via chrome.scripting, so it must be fully self-contained (no refs to
 * anything outside its own body). It returns a plain JSON-safe object.
 * ------------------------------------------------------------------ */
function analyzeUiUx() {
  const MAX_ELEMENTS = 6000;
  const docEl = document.documentElement;

  const inc = (map, key, n = 1) => {
    if (!key && key !== 0) return;
    map[key] = (map[key] || 0) + n;
  };
  const topN = (map, n) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, count }));
  const isMeaningfulColor = (c) =>
    c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";
  const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

  /* ---- meta ---- */
  const metaContent = (selector) => {
    const node = document.querySelector(selector);
    return node ? (node.getAttribute("content") || "").trim() : "";
  };
  const meta = {
    title: document.title || "",
    url: location.href,
    host: location.host,
    lang: docEl.getAttribute("lang") || "",
    dir: docEl.getAttribute("dir") || "ltr",
    charset: document.characterSet || "",
    description: metaContent('meta[name="description"]'),
    viewport: metaContent('meta[name="viewport"]'),
    themeColor: metaContent('meta[name="theme-color"]'),
    generator: metaContent('meta[name="generator"]'),
    ogTitle: metaContent('meta[property="og:title"]'),
    ogImage: metaContent('meta[property="og:image"]'),
    favicon: (() => {
      const link = document.querySelector('link[rel~="icon"]');
      try {
        return link ? new URL(link.getAttribute("href"), location.href).href : "";
      } catch {
        return "";
      }
    })(),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollHeight: docEl.scrollHeight,
    devicePixelRatio: window.devicePixelRatio || 1
  };

  /* ---- walk every element once, collecting computed-style stats ---- */
  const elements = Array.from(document.querySelectorAll("body *")).slice(0, MAX_ELEMENTS);

  const colors = {};
  const bgColors = {};
  const borderColors = {};
  const fontFamilies = {};
  const fontSizes = {};
  const fontWeights = {};
  const lineHeights = {};
  const letterSpacings = {};
  const radii = {};
  const shadows = {};
  const margins = {};
  const paddings = {};
  const gaps = {};
  const zIndexes = {};
  const displays = {};
  const positions = {};

  let flexCount = 0;
  let gridCount = 0;
  let transitionCount = 0;
  let animationCount = 0;
  let backdropCount = 0;
  let gradientCount = 0;
  let stickyCount = 0;
  let fixedCount = 0;

  for (const el of elements) {
    let cs;
    try {
      cs = getComputedStyle(el);
    } catch {
      continue;
    }
    if (!cs || cs.display === "none") continue;

    if (isMeaningfulColor(cs.color)) inc(colors, cs.color);
    if (isMeaningfulColor(cs.backgroundColor)) inc(bgColors, cs.backgroundColor);
    if (cs.borderTopWidth !== "0px" && isMeaningfulColor(cs.borderTopColor)) {
      inc(borderColors, cs.borderTopColor);
    }

    inc(fontFamilies, cs.fontFamily);
    inc(fontSizes, cs.fontSize);
    inc(fontWeights, cs.fontWeight);
    if (cs.lineHeight && cs.lineHeight !== "normal") inc(lineHeights, cs.lineHeight);
    if (cs.letterSpacing && cs.letterSpacing !== "normal") inc(letterSpacings, cs.letterSpacing);

    if (cs.borderTopLeftRadius && cs.borderTopLeftRadius !== "0px") {
      inc(radii, cs.borderTopLeftRadius);
    }
    if (cs.boxShadow && cs.boxShadow !== "none") inc(shadows, cs.boxShadow);

    [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].forEach((m) => {
      if (m && m !== "0px" && !m.startsWith("-")) inc(margins, m);
    });
    [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].forEach((p) => {
      if (p && p !== "0px") inc(paddings, p);
    });
    if (cs.gap && cs.gap !== "normal" && cs.gap !== "0px") inc(gaps, cs.gap);

    inc(displays, cs.display);
    inc(positions, cs.position);
    if (cs.display.includes("flex")) flexCount += 1;
    if (cs.display.includes("grid")) gridCount += 1;
    if (cs.position === "sticky") stickyCount += 1;
    if (cs.position === "fixed") fixedCount += 1;
    if (cs.transitionDuration && cs.transitionDuration !== "0s") transitionCount += 1;
    if (cs.animationName && cs.animationName !== "none") animationCount += 1;
    if (cs.backdropFilter && cs.backdropFilter !== "none") backdropCount += 1;
    if (/gradient/.test(cs.backgroundImage)) gradientCount += 1;
    if (cs.zIndex && cs.zIndex !== "auto") inc(zIndexes, cs.zIndex);
  }

  /* ---- design tokens & media queries from stylesheets ---- */
  const cssVars = {};
  const mediaQueries = {};
  let keyframeCount = 0;
  let crossOriginSheets = 0;
  let readableSheets = 0;

  const collectRules = (rules) => {
    for (const rule of Array.from(rules)) {
      if (rule.style) {
        for (let i = 0; i < rule.style.length; i += 1) {
          const prop = rule.style[i];
          if (prop && prop.startsWith("--")) {
            const value = rule.style.getPropertyValue(prop).trim();
            if (value && !cssVars[prop]) cssVars[prop] = value;
          }
        }
      }
      if (rule.type === CSSRule.MEDIA_RULE) {
        const cond = rule.conditionText || (rule.media && rule.media.mediaText) || "";
        if (cond) inc(mediaQueries, cond);
        if (rule.cssRules) collectRules(rule.cssRules);
      } else if (rule.type === CSSRule.SUPPORTS_RULE && rule.cssRules) {
        collectRules(rule.cssRules);
      } else if (rule.type === CSSRule.KEYFRAMES_RULE) {
        keyframeCount += 1;
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch {
      crossOriginSheets += 1;
      continue;
    }
    if (!rules) continue;
    readableSheets += 1;
    try {
      collectRules(rules);
    } catch {
      /* ignore malformed rules */
    }
  }

  /* ---- headings outline ---- */
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .slice(0, 50)
    .map((h) => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 90) }))
    .filter((h) => h.text);

  /* ---- component inventory ---- */
  const headingCounts = {};
  ["h1", "h2", "h3", "h4", "h5", "h6"].forEach((tag) => {
    headingCounts[tag] = document.querySelectorAll(tag).length;
  });

  const buttonSelector =
    'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
  const components = {
    links: document.querySelectorAll("a[href]").length,
    buttons: document.querySelectorAll(buttonSelector).length,
    inputs: document.querySelectorAll("input, textarea, select").length,
    forms: document.forms.length,
    images: document.images.length,
    svgs: document.querySelectorAll("svg").length,
    videos: document.querySelectorAll("video").length,
    iframes: document.querySelectorAll("iframe").length,
    canvases: document.querySelectorAll("canvas").length,
    lists: document.querySelectorAll("ul, ol").length,
    tables: document.querySelectorAll("table").length,
    dialogs: document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]').length,
    headings: headingCounts
  };

  /* ---- landmarks / structure ---- */
  const landmarks = {
    header: document.querySelectorAll("header").length,
    nav: document.querySelectorAll("nav").length,
    main: document.querySelectorAll("main").length,
    footer: document.querySelectorAll("footer").length,
    aside: document.querySelectorAll("aside").length,
    section: document.querySelectorAll("section").length,
    article: document.querySelectorAll("article").length
  };

  /* ---- representative button samples ---- */
  const seenButtonKey = new Set();
  const buttonSamples = [];
  for (const btn of Array.from(document.querySelectorAll(buttonSelector)).slice(0, 60)) {
    let cs;
    try {
      cs = getComputedStyle(btn);
    } catch {
      continue;
    }
    const key = `${cs.backgroundColor}|${cs.color}|${cs.borderTopLeftRadius}|${cs.fontSize}`;
    if (seenButtonKey.has(key)) continue;
    seenButtonKey.add(key);
    const label = text(btn) || btn.value || btn.getAttribute("aria-label") || "(no label)";
    buttonSamples.push({
      label: label.slice(0, 40),
      background: cs.backgroundColor,
      color: cs.color,
      border: cs.borderTopWidth !== "0px" ? `${cs.borderTopWidth} solid ${cs.borderTopColor}` : "none",
      radius: cs.borderTopLeftRadius,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      boxShadow: cs.boxShadow === "none" ? "" : cs.boxShadow
    });
    if (buttonSamples.length >= 6) break;
  }

  /* ---- link style ---- */
  const linkSample = (() => {
    const link = document.querySelector("a[href]");
    if (!link) return null;
    let cs;
    try {
      cs = getComputedStyle(link);
    } catch {
      return null;
    }
    return {
      color: cs.color,
      textDecoration: cs.textDecorationLine,
      fontWeight: cs.fontWeight
    };
  })();

  /* ---- container widths ---- */
  const containerWidths = {};
  for (const el of elements) {
    let cs;
    try {
      cs = getComputedStyle(el);
    } catch {
      continue;
    }
    if (cs.maxWidth && cs.maxWidth !== "none" && cs.maxWidth.endsWith("px")) {
      const px = parseFloat(cs.maxWidth);
      if (px >= 480) inc(containerWidths, cs.maxWidth);
    }
  }

  /* ---- accessibility ---- */
  const imgs = Array.from(document.images);
  const inputs = Array.from(document.querySelectorAll("input, textarea, select")).filter(
    (el) => !["hidden", "submit", "button", "reset"].includes(el.type)
  );
  const labelledInput = (el) => {
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return true;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true;
    if (el.closest("label")) return true;
    if (el.getAttribute("title") || el.getAttribute("placeholder")) return true;
    return false;
  };
  const buttonsNoText = Array.from(document.querySelectorAll(buttonSelector)).filter((b) => {
    return !text(b) && !b.getAttribute("aria-label") && !b.getAttribute("title") && !b.value;
  }).length;
  const linksNoText = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
    return !text(a) && !a.getAttribute("aria-label") && !a.querySelector("img[alt]:not([alt=''])");
  }).length;

  const a11y = {
    hasLang: Boolean(meta.lang),
    h1Count: headingCounts.h1,
    imagesTotal: imgs.length,
    imagesMissingAlt: imgs.filter((img) => !img.hasAttribute("alt")).length,
    imagesDecorative: imgs.filter((img) => img.getAttribute("alt") === "").length,
    inputsTotal: inputs.length,
    inputsMissingLabel: inputs.filter((el) => !labelledInput(el)).length,
    buttonsNoText,
    linksNoText,
    ariaRoles: document.querySelectorAll("[role]").length,
    ariaLabels: document.querySelectorAll("[aria-label], [aria-labelledby]").length,
    positiveTabindex: document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').length,
    skipLink: Boolean(document.querySelector('a[href^="#"]'))
  };

  /* ---- text sizing buckets (rough readability) ---- */
  return {
    meta,
    elementCount: elements.length,
    truncated: document.querySelectorAll("body *").length > MAX_ELEMENTS,
    palette: {
      text: topN(colors, 10),
      background: topN(bgColors, 10),
      border: topN(borderColors, 8)
    },
    typography: {
      families: topN(fontFamilies, 8),
      sizes: topN(fontSizes, 12),
      weights: topN(fontWeights, 8),
      lineHeights: topN(lineHeights, 6),
      letterSpacings: topN(letterSpacings, 5)
    },
    spacing: {
      margins: topN(margins, 10),
      paddings: topN(paddings, 10),
      gaps: topN(gaps, 8)
    },
    radii: topN(radii, 8),
    shadows: topN(shadows, 6),
    zIndexes: topN(zIndexes, 8),
    layout: {
      displays: topN(displays, 8),
      positions: topN(positions, 6),
      flexCount,
      gridCount,
      stickyCount,
      fixedCount,
      containerWidths: topN(containerWidths, 5)
    },
    effects: {
      transitionCount,
      animationCount,
      keyframeCount,
      backdropCount,
      gradientCount
    },
    tokens: { cssVars, count: Object.keys(cssVars).length },
    responsive: {
      mediaQueries: topN(mediaQueries, 16),
      viewport: meta.viewport
    },
    stylesheets: { readable: readableSheets, crossOrigin: crossOriginSheets },
    headings,
    components,
    landmarks,
    buttonSamples,
    linkSample,
    a11y
  };
}

/* ------------------------------------------------------------------ *
 * Markdown report builder (runs in the service worker).
 * ------------------------------------------------------------------ */
function rgbToHex(value) {
  const match = String(value).match(/rgba?\(([^)]+)\)/i);
  if (!match) return value;
  const parts = match[1].split(",").map((p) => p.trim());
  const [r, g, b] = parts.map((p) => parseFloat(p));
  if ([r, g, b].some((n) => Number.isNaN(n))) return value;
  const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
  const hex = "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
  return a < 1 ? `${hex} (alpha ${a})` : hex;
}

function colorRows(items) {
  if (!items.length) return "_None detected._\n";
  return (
    "| Color | Hex | Uses |\n| --- | --- | --- |\n" +
    items.map((i) => `| \`${i.value}\` | \`${rgbToHex(i.value)}\` | ${i.count} |`).join("\n") +
    "\n"
  );
}

function freqTable(items, header = "Value") {
  if (!items.length) return "_None detected._\n";
  return (
    `| ${header} | Uses |\n| --- | --- |\n` +
    items.map((i) => `| \`${i.value}\` | ${i.count} |`).join("\n") +
    "\n"
  );
}

function listLine(label, value) {
  return `- **${label}:** ${value}`;
}

function buildMarkdown(data) {
  const m = data.meta;
  const now = new Date();
  const out = [];

  out.push(`# UI/UX Analysis — ${m.title || m.host}`);
  out.push("");
  out.push(`> Generated by **UXRay v${EXTENSION_VERSION}** on ${now.toLocaleString()}`);
  out.push("");

  /* Overview */
  out.push("## 1. Overview");
  out.push("");
  out.push(listLine("Page title", m.title || "_(none)_"));
  out.push(listLine("URL", m.url));
  out.push(listLine("Description", m.description || "_(none)_"));
  out.push(listLine("Language", m.lang || "_(not set)_") + `  ·  Direction: ${m.dir}`);
  out.push(listLine("Charset", m.charset || "_(unknown)_"));
  if (m.generator) out.push(listLine("Generator / tech hint", m.generator));
  if (m.themeColor) out.push(listLine("Theme color", `\`${m.themeColor}\``));
  out.push(listLine("Viewport meta", m.viewport ? `\`${m.viewport}\`` : "_(missing — not mobile-optimized?)_"));
  out.push(
    listLine(
      "Captured viewport",
      `${m.innerWidth}×${m.innerHeight} px (DPR ${m.devicePixelRatio}), full height ${m.scrollHeight}px`
    )
  );
  out.push(listLine("Elements analyzed", `${data.elementCount}${data.truncated ? " (capped at 6000)" : ""}`));
  out.push("");

  /* Color palette */
  out.push("## 2. Color Palette");
  out.push("");
  out.push("### Text colors");
  out.push(colorRows(data.palette.text));
  out.push("### Background colors");
  out.push(colorRows(data.palette.background));
  out.push("### Border colors");
  out.push(colorRows(data.palette.border));

  /* Typography */
  out.push("## 3. Typography");
  out.push("");
  out.push("### Font families");
  out.push(freqTable(data.typography.families, "Font stack"));
  out.push("### Font sizes (type scale)");
  out.push(freqTable(data.typography.sizes, "Size"));
  out.push("### Font weights");
  out.push(freqTable(data.typography.weights, "Weight"));
  out.push("### Line heights");
  out.push(freqTable(data.typography.lineHeights, "Line height"));
  if (data.typography.letterSpacings.length) {
    out.push("### Letter spacing");
    out.push(freqTable(data.typography.letterSpacings, "Letter spacing"));
  }

  /* Spacing */
  out.push("## 4. Spacing & Sizing");
  out.push("");
  out.push("### Padding scale");
  out.push(freqTable(data.spacing.paddings, "Padding"));
  out.push("### Margin scale");
  out.push(freqTable(data.spacing.margins, "Margin"));
  if (data.spacing.gaps.length) {
    out.push("### Fl/Grid gaps");
    out.push(freqTable(data.spacing.gaps, "Gap"));
  }
  out.push("### Border radius");
  out.push(freqTable(data.radii, "Radius"));
  if (data.shadows.length) {
    out.push("### Box shadows (elevation)");
    out.push(freqTable(data.shadows, "Shadow"));
  }

  /* Layout */
  out.push("## 5. Layout & Structure");
  out.push("");
  const lm = data.landmarks;
  out.push(
    listLine(
      "Semantic landmarks",
      `header ${lm.header} · nav ${lm.nav} · main ${lm.main} · aside ${lm.aside} · section ${lm.section} · article ${lm.article} · footer ${lm.footer}`
    )
  );
  const ly = data.layout;
  out.push(listLine("Flexbox containers", ly.flexCount));
  out.push(listLine("Grid containers", ly.gridCount));
  out.push(listLine("Sticky elements", ly.stickyCount) + `  ·  Fixed: ${ly.fixedCount}`);
  out.push("");
  out.push("### Display values");
  out.push(freqTable(ly.displays, "display"));
  if (ly.containerWidths.length) {
    out.push("### Content container max-widths");
    out.push(freqTable(ly.containerWidths, "max-width"));
  }
  if (data.zIndexes.length) {
    out.push("### Z-index layers");
    out.push(freqTable(data.zIndexes, "z-index"));
  }

  /* Components */
  out.push("## 6. Component Inventory");
  out.push("");
  const c = data.components;
  out.push("| Component | Count |");
  out.push("| --- | --- |");
  out.push(`| Links | ${c.links} |`);
  out.push(`| Buttons | ${c.buttons} |`);
  out.push(`| Form inputs | ${c.inputs} |`);
  out.push(`| Forms | ${c.forms} |`);
  out.push(`| Images | ${c.images} |`);
  out.push(`| Inline SVGs | ${c.svgs} |`);
  out.push(`| Videos | ${c.videos} |`);
  out.push(`| Iframes | ${c.iframes} |`);
  out.push(`| Canvas | ${c.canvases} |`);
  out.push(`| Lists | ${c.lists} |`);
  out.push(`| Tables | ${c.tables} |`);
  out.push(`| Dialogs / modals | ${c.dialogs} |`);
  out.push("");
  out.push(
    listLine(
      "Headings",
      `h1 ${c.headings.h1} · h2 ${c.headings.h2} · h3 ${c.headings.h3} · h4 ${c.headings.h4} · h5 ${c.headings.h5} · h6 ${c.headings.h6}`
    )
  );
  out.push("");

  /* Button styles */
  if (data.buttonSamples.length) {
    out.push("### Button / CTA styles");
    out.push("");
    data.buttonSamples.forEach((b, i) => {
      out.push(`**Button ${i + 1} — "${b.label}"**`);
      out.push("");
      out.push("```css");
      out.push(`background: ${b.background};`);
      out.push(`color: ${b.color};`);
      out.push(`border: ${b.border};`);
      out.push(`border-radius: ${b.radius};`);
      out.push(`padding: ${b.padding};`);
      out.push(`font: ${b.fontWeight} ${b.fontSize};`);
      if (b.boxShadow) out.push(`box-shadow: ${b.boxShadow};`);
      out.push("```");
      out.push("");
    });
  }
  if (data.linkSample) {
    out.push(
      listLine(
        "Link style",
        `color \`${data.linkSample.color}\`, decoration ${data.linkSample.textDecoration}, weight ${data.linkSample.fontWeight}`
      )
    );
    out.push("");
  }

  /* Headings outline */
  if (data.headings.length) {
    out.push("## 7. Content Outline (heading structure)");
    out.push("");
    data.headings.forEach((h) => {
      out.push(`${"  ".repeat(Math.max(0, h.level - 1))}- H${h.level}: ${h.text}`);
    });
    out.push("");
  }

  /* Effects */
  out.push("## 8. Motion & Effects");
  out.push("");
  const fx = data.effects;
  out.push(listLine("Elements with transitions", fx.transitionCount));
  out.push(listLine("Elements with animations", fx.animationCount));
  out.push(listLine("@keyframes defined", fx.keyframeCount));
  out.push(listLine("Gradient backgrounds", fx.gradientCount));
  out.push(listLine("Backdrop filters (glass/blur)", fx.backdropCount));
  out.push("");

  /* Design tokens */
  out.push("## 9. Design Tokens (CSS variables)");
  out.push("");
  if (data.tokens.count) {
    out.push(`Found **${data.tokens.count}** custom properties:`);
    out.push("");
    out.push("```css");
    out.push(":root {");
    Object.entries(data.tokens.cssVars)
      .slice(0, 120)
      .forEach(([k, v]) => out.push(`  ${k}: ${v};`));
    out.push("}");
    out.push("```");
  } else {
    out.push("_No CSS custom properties were exposed (or all stylesheets were cross-origin)._");
  }
  out.push("");

  /* Responsive */
  out.push("## 10. Responsive Design");
  out.push("");
  out.push(listLine("Viewport meta", m.viewport ? `\`${m.viewport}\`` : "_(missing)_"));
  out.push(
    listLine(
      "Stylesheets",
      `${data.stylesheets.readable} readable, ${data.stylesheets.crossOrigin} cross-origin (rules hidden by CORS)`
    )
  );
  out.push("");
  out.push("### Media query breakpoints");
  out.push(freqTable(data.responsive.mediaQueries, "Condition"));

  /* Accessibility */
  out.push("## 11. Accessibility Snapshot");
  out.push("");
  const a = data.a11y;
  const flag = (bad) => (bad ? "⚠️" : "✅");
  out.push(`- ${flag(!a.hasLang)} Document \`lang\` attribute: ${a.hasLang ? "present" : "**missing**"}`);
  out.push(
    `- ${flag(a.h1Count !== 1)} H1 headings: ${a.h1Count} ${
      a.h1Count === 1 ? "" : "(ideally exactly 1)"
    }`
  );
  out.push(
    `- ${flag(a.imagesMissingAlt > 0)} Images missing \`alt\`: ${a.imagesMissingAlt} of ${a.imagesTotal} (${a.imagesDecorative} marked decorative)`
  );
  out.push(
    `- ${flag(a.inputsMissingLabel > 0)} Form fields without a label: ${a.inputsMissingLabel} of ${a.inputsTotal}`
  );
  out.push(`- ${flag(a.buttonsNoText > 0)} Buttons with no accessible name: ${a.buttonsNoText}`);
  out.push(`- ${flag(a.linksNoText > 0)} Links with no accessible name: ${a.linksNoText}`);
  out.push(`- ${flag(a.positiveTabindex > 0)} Positive \`tabindex\` (focus-order risk): ${a.positiveTabindex}`);
  out.push(`- ℹ️ ARIA roles used: ${a.ariaRoles} · aria-label/labelledby: ${a.ariaLabels}`);
  out.push("");

  out.push("---");
  out.push("");
  out.push(
    "_UXRay analyzes only the rendered client-side UI of the current page. Cross-origin stylesheet internals, server-rendered logic, and off-screen lazy content may not be fully represented. Scroll the page and re-run for richer results._"
  );
  out.push("");

  return out.join("\n");
}

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */
function strToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return (
    [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join("-") +
    "_" +
    [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join("-")
  );
}

function sanitize(name) {
  return String(name || "page")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "page";
}

function download(filename, dataUrl) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: dataUrl, filename, conflictAction: "uniquify", saveAs: false },
      (id) => {
        const error = chrome.runtime.lastError;
        error ? reject(new Error(error.message)) : resolve(id);
      }
    );
  });
}

async function runAnalysis(tab) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    func: analyzeUiUx
  });

  if (!injection || !injection.result) {
    throw new Error("The page returned no analysis data.");
  }

  const data = injection.result;
  const markdown = buildMarkdown(data);
  const host = sanitize(data.meta.host || "page");
  const filename = `${ROOT_FOLDER}/${host}_${timestamp()}.md`;

  // Note: nothing is saved here. The report is handed back to the popup and
  // only written to disk when the user clicks Download.
  return {
    markdown,
    filename,
    summary: {
      filename,
      host: data.meta.host,
      elementCount: data.elementCount,
      colors: data.palette.text.length + data.palette.background.length,
      fonts: data.typography.families.length,
      components: data.components,
      tokens: data.tokens.count,
      breakpoints: data.responsive.mediaQueries.length
    }
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.action) return false;

  if (message.action === "analyze") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !/^https?:/i.test(tab.url || "")) {
        sendResponse({ ok: false, error: "Open a normal http or https page first." });
        return;
      }

      runAnalysis(tab)
        .then((report) =>
          sendResponse({ ok: true, summary: report.summary, markdown: report.markdown, filename: report.filename })
        )
        .catch((error) => sendResponse({ ok: false, error: error.message }));
    });

    return true; // async response
  }

  if (message.action === "download") {
    const markdown = String(message.markdown || "");
    const filename = message.filename || `${ROOT_FOLDER}/report_${timestamp()}.md`;
    if (!markdown) {
      sendResponse({ ok: false, error: "Nothing to download — run an analysis first." });
      return false;
    }

    download(filename, `data:text/markdown;base64,${strToBase64(markdown)}`)
      .then(() => sendResponse({ ok: true, filename }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true; // async response
  }

  return false;
});
