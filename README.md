# Taxi-Minute

An NYC yellow-taxi trip-duration predictor with a model that runs in the visitor's browser. The training pipeline checks the [NYC TLC yellow-taxi trip records](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page), validates a new model against a later month, and publishes the website through GitHub Pages.

## Run locally

Requires [uv](https://docs.astral.sh/uv/) and Node.js 20 or newer. The first training run downloads four TLC Parquet files into `.data/` and can take several minutes. Only a deterministic 8% sample of valid trips from each file is loaded into memory; the raw files stay out of Git.

```sh
uv sync
uv run python scripts/update.py
npm test
python3 -m http.server 8000 --directory site
```

Open `http://localhost:8000` in a browser. To retrain with the same published months, add `--force`. To use specific months, pass `--months 2025-07 2025-08 2025-09 2025-10`.

## Model and evaluation

- **Target:** trip duration in minutes, clipped to the supported 2–120 minute range.
- **Inputs known before departure:** pickup zone, drop-off zone, and scheduled departure date and hour in New York time. The metered trip distance is deliberately excluded because it is known only after a ride.
- **Training:** LightGBM regression on the first three of the latest four published months. A deterministic 8% hash sample limits free-runner resource use.
- **Validation:** the newest of those four months, never used to train the candidate. The report includes mean, median, and 90th-percentile absolute error, plus a route-median baseline. Promotion fails if the candidate exceeds the route baseline by more than 3%, or an existing model by more than 1% on that same month.
- **Browser parity:** `npm test` compares predictions from the published tree model with native LightGBM predictions on held-out trips.

`site/metadata.json` records the model version, data months, sample size, metrics, source URLs, and source file hashes. `models/champion.txt` is the native model used to compare the next candidate. The site displays its validation month and error.

## Automatic updates

`.github/workflows/update-and-deploy.yml` checks weekly and can also be run manually. It exits without a commit if the newest published month has not changed. If a model passes, it commits the model, metadata, and parity cases, then directly deploys the static site. A failed check leaves the current site and model intact.

Before using the workflow, create a **public** GitHub repository, push this project, and select **GitHub Actions** as the Pages build source in repository settings. The scheduled workflow can stop after 60 days of repository inactivity, and GitHub may delay or drop individual scheduled runs. The website remains usable with the last published model; the displayed month makes stale updates visible.

## Limits

The prediction is for NYC yellow-taxi trips between TLC zones. It is not a live traffic estimate or a street-address route. The displayed range uses the 80th percentile of absolute error on one validation month, so coverage can differ across routes and traffic conditions. TLC records arrive with a delay and may contain errors; the pipeline filters invalid rows but cannot eliminate all source issues.
