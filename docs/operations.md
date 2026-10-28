# Updates and deployment

## Weekly run

[The GitHub Actions workflow](../.github/workflows/update-and-deploy.yml) is scheduled for each Monday at **08:17 UTC** (04:17 in New York during daylight saving time; 03:17 during standard time). Open [Actions → Update model and deploy site](https://github.com/codewithdaniel1/taxi-minute/actions/workflows/update-and-deploy.yml) to see runs or select **Run workflow** to start one manually. It installs locked dependencies, checks the TLC page for the latest yellow-taxi month, trains and evaluates a candidate when new data exists, runs the browser parity test, commits promoted model artifacts to `main`, and deploys [`site/`](../site/) to [GitHub Pages](https://codewithdaniel1.github.io/taxi-minute/).

If the newest month has not changed, the scheduled run makes no commit and skips deployment. A manual run redeploys the current site even if no new model is approved. If training, quality checks, tests, or deployment fail, the workflow reports a failure; inspect its logs in the [Actions tab](https://github.com/codewithdaniel1/taxi-minute/actions). A rejected candidate keeps the current model.

[GitHub may delay or drop scheduled jobs and automatically disables scheduled workflows in public repositories after 60 days without repository activity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). The weekly schedule is therefore best effort and cannot be guaranteed to continue during a long period away. The website still serves the last deployed model. Check the validation month on the site or in [`site/metadata.json`](../site/metadata.json), inspect the [run history](https://github.com/codewithdaniel1/taxi-minute/actions/workflows/update-and-deploy.yml), and [re-enable the workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows) if GitHub disabled it. Then use **Run workflow** to check for new TLC data and redeploy.

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
