# Last Asylum Pack Solver

CLI scripts to analyze packages/exchange shops from `data/pack_data.json` (Last Asylum: Plague), plus a small
static webapp (in `webapp/`) that renders the same analysis in the browser and is deployed to GitHub Pages.

## CLI scripts

See `package.json` for the full list. The most relevant ones:

- `npm run analyze-item-value -- <item_id> [target_quantity]` — best way to buy a given item.
- `npm run rank-packages` — ranks every package/exchange offer/bonus tier by value for money, writing
  `output/value_ranking.json`.

## Webapp

The `webapp/` folder is a small [Vite](https://vitejs.dev/) app with two pages:

- **Analyze Item Value** (`index.html`) — pick an item, an amount, and optionally exceed purchase limits; renders
  the same purchase-plan calculation as `analyze-item-value.js`, directly in the page.
- **Value Ranking** (`rankings.html`) — a searchable, filterable view of the full `value_ranking.json` ranking.

Both pages are ready to show per-item images once they exist: drop a `<item_id>.png` file into
`webapp/public/assets/items/` and it will be picked up automatically (items without an image fall back to a
placeholder icon).

### Running locally

```bash
npm run generate-webapp-data   # (re)builds output/*.json and copies data into webapp/public/data
npm run webapp:install         # first time only
npm run webapp:dev             # starts the Vite dev server
```

### Deploying to GitHub Pages

`.github/workflows/deploy-webapp.yml` builds the webapp (regenerating `value_ranking.json` and
`item_value_index.json` from the current `data/pack_data.json` every time) and deploys it on every push to `main`,
or manually via "Run workflow".

One-time repository setup: in **Settings → Pages**, set **Source** to **GitHub Actions**.
