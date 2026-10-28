# Updates and deployment

## Weekly run

[The GitHub Actions workflow](../.github/workflows/update-and-deploy.yml) runs each Monday at **08:17 UTC** and can also be started with **Actions → Update model and deploy site → Run workflow**. It installs locked dependencies, checks the TLC page for the latest yellow-taxi month, trains and evaluates a candidate when new data exists, runs the browser parity test, commits promoted model artifacts to `main`, and deploys [`site/`](../site/) to [GitHub Pages](https://codewithdaniel1.github.io/taxi-minute/).

If the newest month has not changed, the scheduled run makes no commit and skips deployment. A manual run redeploys the current site even if no new model is approved. If training, quality checks, tests, or deployment fail, the workflow reports a failure; inspect its logs in the [Actions tab](https://github.com/codewithdaniel1/taxi-minute/actions). A rejected candidate keeps the current model.

[GitHub may delay or skip scheduled jobs and automatically disables schedules in public repositories after 60 days without activity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). The website still serves the last deployed model in that case; check the validation month on the site or in [`site/metadata.json`](../site/metadata.json) and [re-enable the workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows) when needed.

## Local commands

Install [uv](https://docs.astral.sh/uv/) and Node.js 20 or newer, then run from the repository root:

```sh
uv sync
uv run python scripts/update.py
npm test
python3 -m http.server 8000 --directory site
```

`uv run python scripts/update.py --force` retrains on the latest four discoverable months even if the validation month has not changed. `--months YYYY-MM YYYY-MM YYYY-MM YYYY-MM` selects four published months for a reproducible run. Raw downloads are cached under `.data/` and are ignored by Git. To preview the website, open <http://localhost:8000>.

## Deployment settings

The repository is public and [GitHub Pages is configured to use **GitHub Actions** as its build source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). The workflow needs `contents: write` to commit approved artifacts and `pages: write` plus `id-token: write` to deploy. The `github-pages` environment points to the live website. No paid hosting or prediction API is required for this setup, though GitHub's service limits and policies can change.
