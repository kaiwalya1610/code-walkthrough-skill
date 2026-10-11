# Vendored browser libraries

The builder inlines these files into every generated page, so the dashboard keeps working offline with no CDN. Each is the unmodified browser (IIFE) build published on npm.

| File | Package | Version | License | SHA-256 |
|---|---|---|---|---|
| `mermaid.min.js` | [mermaid](https://mermaid.js.org) | 11.17.2 | MIT (`mermaid.LICENSE`) | `581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8` |
| `svg-pan-zoom.min.js` | [svg-pan-zoom](https://github.com/bumbu/svg-pan-zoom) | 3.6.2 | BSD-2-Clause (`svg-pan-zoom.LICENSE`) | `9c8fc41b3359e699990766dd7a943595d234a80c880a90dfc14b920a273b99d8` |

Mermaid draws every diagram: the generated codebase map, branch diagrams, the run-lanes sequence diagram, and any `mermaid` diagrams the walkthrough author writes. svg-pan-zoom adds zoom and pan controls to the larger diagrams on the Overview.

To upgrade, download the new `dist/` file into an empty directory, compare it, copy it here, update this table, rebuild the example, and run both test suites:

```bash
curl -fLO https://cdn.jsdelivr.net/npm/mermaid@<version>/dist/mermaid.min.js
shasum -a 256 mermaid.min.js
```
