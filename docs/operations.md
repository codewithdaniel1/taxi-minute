# MLOps operations and deployment

## Weekly run

[The GitHub Actions workflow](../.github/workflows/update-and-deploy.yml) is scheduled for each Monday at **08:17 UTC** (04:17 in New York during daylight saving time; 03:17 during standard time). Open [Actions → Update model and deploy site](https://github.com/codewithdaniel1/taxi-minute/actions/workflows/update-and-deploy.yml) to see runs or select **Run workflow** to start one manually. It installs locked dependencies, checks the TLC page for the latest yellow-taxi month, trains and evaluates a candidate when new data exists, runs the browser parity test, commits promoted model artifacts to `main`, and deploys [`site/`](../site/) to [GitHub Pages](https://codewithdaniel1.github.io/taxi-minute/).

If the newest month has not changed, the scheduled run makes no commit and skips deployment. A manual run redeploys the current site even if no new model is approved. If training, quality checks, tests, or deployment fail, the workflow reports a failure; inspect its logs in the [Actions tab](https://github.com/codewithdaniel1/taxi-minute/actions). A rejected candidate keeps the current model.

[GitHub may delay or drop scheduled jobs and automatically disables scheduled workflows in public repositories after 60 days without repository activity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). The weekly schedule is therefore best effort and cannot be guaranteed to continue during a long period away. The website still serves the last deployed model. Check the validation month on the site or in [`site/metadata.json`](../site/metadata.json), inspect the [run history](https://github.com/codewithdaniel1/taxi-minute/actions/workflows/update-and-deploy.yml), and [re-enable the workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows) if GitHub disabled it. Then use **Run workflow** to check for new TLC data and redeploy.

## What to monitor

| Signal | Where to check | What it means |
| --- | --- | --- |
| Last run and job result | [Workflow run history](https://github.com/codewithdaniel1/taxi-minute/actions/workflows/update-and-deploy.yml) | A missing or failed run needs investigation; a successful run may still publish nothing if no newer month exists. |
| Published validation month | [Live website](https://codewithdaniel1.github.io/taxi-minute/) or [`site/metadata.json`](../site/metadata.json) | Shows which TLC month the served model was evaluated on. Compare it with the latest yellow-taxi month on the [TLC page](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page). |
| Model quality | [`site/metadata.json`](../site/metadata.json) | Holds candidate errors, baseline errors, row counts, and source hashes for the published release. |

There is no automatic alerting or live outcome monitoring. The browser makes predictions without recording actual trip durations, so production error cannot be measured from user traffic. The published model stays available if an update is skipped or fails.

## When a run needs attention

1. Open the failed run and identify whether discovery/download, training, tests, Git push, or Pages deployment failed. Fix the relevant stage and use **Run workflow** again.
2. If the run succeeds without a commit, compare the latest TLC month with the validation month in `site/metadata.json`. No newer month means there is nothing to retrain; a candidate that loses to the incumbent is also kept out of production.
3. If GitHub disabled the schedule, [re-enable the workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows) and run it manually. Check the website's validation month afterward.
4. If a published model must be rolled back, use the earlier Git commit as the source for `site/model.json`, `site/zones.json`, `site/metadata.json`, `models/champion.txt`, and `tests/parity_cases.json`, and run `npm test`. The current workflow has no deploy-only rollback path: **Run workflow** checks for newer TLC data first and may train another candidate. Add a deploy-only path or perform a reviewed manual Pages deployment before relying on rollback in production.

## Local commands

Install [uv](https://docs.astral.sh/uv/) and Node.js 20 or newer, then run from the repository root:

```sh
uv sync
uv run python scripts/update.py
npm test
python3 -m http.server 8000 --directory site
```

`uv run python scripts/update.py --force` retrains on the latest four discoverable months even if the validation month has not changed. `--months YYYY-MM YYYY-MM YYYY-MM YYYY-MM` selects four published months for a reproducible run. Raw downloads are cached under `.data/`, created on demand, and ignored by Git. An empty `data/` folder is not used. On GitHub Actions runners, the cache disappears after each run. To preview the website, open <http://localhost:8000>.

The taxi-zone boundaries are a committed static asset and do not need rebuilding for each model update. If TLC revises its shapefile, rebuild them with `uv run --no-project --with pyshp --with pyproj python3 scripts/build_zone_boundaries.py`, review the changed file, and run `npm test` before committing it.

## Deployment settings

The repository is public and [GitHub Pages is configured to use **GitHub Actions** as its build source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). The workflow needs `contents: write` to commit approved artifacts and `pages: write` plus `id-token: write` to deploy. The `github-pages` environment points to the live website. No paid hosting or prediction API is required for this setup, though GitHub's service limits and policies can change.
