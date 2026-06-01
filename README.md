# PageVault

PageVault is a Chrome extension for saving the client-side files that the current page has already loaded and turning them into a local UI clone kit. It is meant to help you study, rebuild, or prototype a similar UI/UX faster.

The priority export is `_clone.html`: a static visual snapshot of the current page DOM with CSS, image, font, and other asset links rewritten to the local files where PageVault can match them. PageVault also saves `_reference.png`, `_index.html`, and `_archive.json`.

Important: PageVault helps with visible client-side UI. It cannot recover backend source code, private APIs, databases, original Figma files, or the clean React/Vue/Svelte components used before a site was bundled.

## UI Clone Kit

When **Clone page** is enabled, PageVault creates:

- `_clone.html`: a local static page that uses the captured DOM and locally saved assets.
- `_reference.png`: a screenshot of the page at capture time, useful as a rebuild reference.
- `_index.html`: a searchable list of captured files.
- `_archive.json`: machine-readable metadata for every saved or failed file.

The clone page disables scripts on purpose. This keeps the captured UI stable when opened from disk, instead of letting the original app JavaScript redirect, call APIs, or mutate the page.

For the best clone:

1. Open the target page and wait for it to finish loading.
2. Scroll and interact with the page so lazy images, menus, and sections load.
3. Open PageVault.
4. Keep **Clone page**, **HTML**, **CSS**, **Images**, **Fonts**, and **Data** enabled.
5. Click **Build clone kit**.
6. Open `Downloads/PageVault/<archive-folder>/_clone.html`.

## What it can and cannot save

PageVault saves what your browser receives:

- HTML documents
- CSS stylesheets and CSS-in-JS style tags already in the DOM
- JavaScript bundles
- Images, SVGs, icons, and fonts
- JSON/XML data responses already loaded by the page
- Sourcemaps when the site exposes them
- Optional media files

PageVault cannot save:

- Server-side code
- Databases
- Private API keys
- Original source files that were not shipped to the browser
- Full multi-page sites that were not visited

## Features

- Captures the active page through the Chrome DevTools Protocol.
- Saves cross-origin files from the browser cache without CORS re-fetch failures.
- Creates a local `_clone.html` for UI rebuilding.
- Rewrites HTML asset references to local paths where possible.
- Rewrites CSS `url(...)` and `@import` references inside saved stylesheets.
- Saves a screenshot reference as `_reference.png`.
- Lets you choose resource types: HTML, CSS, JS, images, fonts, data, sourcemaps, media, and other files.
- Saves your capture/export preferences.
- Generates a searchable `_index.html` with filters and file-size totals.
- Generates `_archive.json` for scripts, audits, or later processing.
- Supports cancellation while a capture is running.

## Install

1. Open `chrome://extensions` in Chrome, Edge, Brave, or another Chromium browser.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Pin PageVault from the browser extensions menu if you want quick access.

## Output

```text
Downloads/
+-- PageVault/
    +-- example.com_2026-05-22_15-30-00/
        +-- _clone.html
        +-- _reference.png
        +-- _archive.json
        +-- _index.html
        +-- example.com/
        |   +-- index.html
        |   +-- css/site.css
        |   +-- js/app.js
        +-- cdn.example.net/
            +-- assets/logo.png
```

## Project Structure

```text
web-source-downloader/
+-- manifest.json
+-- background.js
+-- popup.html
+-- popup.js
+-- icon.svg
+-- icon128.png
+-- README.md
```

## Permissions

- `debugger`: reads loaded resources and captures the DOM through the Chrome DevTools Protocol.
- `downloads`: saves the clone kit files.
- `storage`: remembers your selected filters and export options.
- `tabs`: reads the active tab URL and title.
- `host_permissions: <all_urls>`: allows the extension to work on the page you choose.

PageVault does not upload captured data anywhere.

## Legal Note

Use this for your own sites, debugging, learning, prototyping, and personal archival. Be careful when cloning another site's UI/UX: visual design, brand assets, copy, icons, images, and code can be protected by copyright, trademark, contracts, or site terms.
