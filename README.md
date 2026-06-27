# UXRay

UXRay is a Chrome extension that **X-rays any website's UI/UX** and generates a single, detailed **Markdown report** of everything related to its design — colors, typography, spacing, components, layout, design tokens, motion, responsive breakpoints, and accessibility.

Open a page, click **Analyze UI/UX** to scan it, review the summary, then click **Download** to save the `.md` file to `Downloads/UXRay/`. Nothing is written to disk until you choose to download — just one clean report you can read, share, or feed to an AI/design tool.

## What the report contains

1. **Overview** — title, URL, description, language, viewport, tech hints, page dimensions.
2. **Color Palette** — most-used text, background, and border colors (with hex).
3. **Typography** — font families, the full type scale, weights, line heights, letter spacing.
4. **Spacing & Sizing** — padding/margin scale, flex/grid gaps, border-radius scale, box-shadow elevation.
5. **Layout & Structure** — semantic landmarks, flex vs grid usage, sticky/fixed elements, container widths, z-index layers.
6. **Component Inventory** — counts of buttons, links, inputs, forms, images, SVGs, tables, dialogs, headings, plus sampled button/CTA styles.
7. **Content Outline** — the page's heading (H1–H6) structure.
8. **Motion & Effects** — transitions, animations, keyframes, gradients, backdrop blur.
9. **Design Tokens** — extracted CSS custom properties (`--variables`).
10. **Responsive Design** — viewport meta and the media-query breakpoints found.
11. **Accessibility Snapshot** — missing alt text, unlabeled inputs, heading issues, ARIA usage, focus-order risks.

## How to use

1. Open the page you want to study and let it finish loading.
2. Scroll through it so lazy-loaded sections render (richer results).
3. Click the UXRay icon, then **Analyze UI/UX**.
4. Review the summary, then click **Download .md report**.
5. Open `Downloads/UXRay/<host>_<timestamp>.md`.

## Install

1. Open `chrome://extensions` in Chrome, Edge, Brave, or another Chromium browser.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. Pin UXRay for quick access.

## Project structure

```text
page-vault/
+-- manifest.json
+-- background.js   # injects the analyzer, builds the Markdown report, saves it
+-- popup.html      # single "Analyze UI/UX" UI
+-- popup.js        # popup logic
+-- icon.svg
+-- icon128.png
+-- README.md
```

## Permissions

- `scripting`: runs the read-only analyzer in the active page.
- `downloads`: saves the Markdown report.
- `activeTab` / `tabs`: reads the active tab's URL and title.
- `host_permissions: <all_urls>`: lets you analyze whichever page you choose.

UXRay reads the page's rendered styles and DOM only. It does not modify the page, upload anything, or capture source files.

## Limitations

- Only the **rendered client-side UI** of the current page is analyzed.
- Internals of **cross-origin stylesheets** are hidden by the browser (CORS), so some CSS variables and breakpoints from third-party CSS may not appear.
- Off-screen, lazy-loaded content isn't measured until it renders — scroll and re-run for a fuller picture.

## Legal note

Use this for learning, auditing, prototyping, and your own design work. When studying another site's UI/UX, remember that visual design, brand assets, copy, and code can be protected by copyright, trademark, or terms of service.
