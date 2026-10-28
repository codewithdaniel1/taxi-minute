# Taxi-Minute

**Estimate an NYC yellow-taxi ride time before you leave.** Search pickup and drop-off addresses or place pins on the map, choose a departure time, and get an estimated duration and rough range. Addresses and pins are matched to TLC taxi zones; the prediction itself runs in your browser.

**[Try the live website](https://codewithdaniel1.github.io/taxi-minute/)** · [See the current model and data months](site/metadata.json) · [View the update workflow](.github/workflows/update-and-deploy.yml)

## How it works

```text
NYC TLC monthly yellow-taxi records
    → filter and sample trips
    → train on earlier months
    → validate on the newest month
    → compare with a baseline and the current model
    → commit approved model files
    → deploy the static website to GitHub Pages
    → predict in the visitor's browser
```

The model uses only information available before a ride: taxi zones and departure date and time. It does not use the metered trip distance or live traffic. [Data and model details](docs/data-and-model.md) explain the source, map inputs, filters, features, validation, and limits.

## Project map

| Path | Purpose |
| --- | --- |
| [`site/`](site/) | Static map website, browser model, taxi-zone boundaries and names, and current model metadata |
| [`src/taxi_minute/`](src/taxi_minute/) | TLC discovery, download, filtering, and feature encoding |
| [`scripts/update.py`](scripts/update.py) | Train, evaluate, and publish an approved model |
| [`scripts/build_zone_boundaries.py`](scripts/build_zone_boundaries.py) | Convert the official TLC shapefile into browser-ready zone boundaries |
| [`models/champion.txt`](models/champion.txt) | Native LightGBM model for the next update's comparison |
| [`tests/`](tests/) | Browser versus native model prediction checks |
| [`.github/workflows/update-and-deploy.yml`](.github/workflows/update-and-deploy.yml) | Weekly update, tests, commit, and Pages deployment |

Downloaded trip files live in `.data/` locally and are ignored by Git. The committed browser model, boundaries, and metadata are the website's deployable artifacts. The native model, parity cases, and lockfile support reliable updates and checks.

## Run locally

Install [uv](https://docs.astral.sh/uv/) and Node.js 20 or newer. From the repository root:

```sh
uv sync
uv run python scripts/update.py
npm test
python3 -m http.server 8000 --directory site
```

Open <http://localhost:8000>. If no newer TLC month is available, the update command exits without changing the model; use `--force` to retrain with the latest four published months. The first training run downloads four Parquet files and can take several minutes. See [operations](docs/operations.md) for manual runs, automation, and troubleshooting.

## Current status and scope

The website shows the validation month and error for the model it serves. [`site/metadata.json`](site/metadata.json) records training and validation months, row counts, metrics, source URLs, and SHA-256 hashes; it is updated whenever a new model is promoted. The weekly GitHub Actions run checks for a newer TLC month and only commits a model that passes the quality gates. The site remains available with the last published model when no new model is promoted.

Predictions cover historical NYC yellow-taxi trips between TLC taxi zones, with supported trip durations of 2–120 minutes. Addresses and pins select zones, so two addresses in the same zones at the same departure time get the same prediction. They are planning estimates, not promises for a particular street address or traffic condition. [Read the model limitations](docs/data-and-model.md#limitations).
