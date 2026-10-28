"""Check TLC data, validate a candidate, and publish a browser model."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from taxi_minute.data import discover_months, download, load_month, save_json, sha256, zone_lookup  # noqa: E402
from taxi_minute.features import FEATURE_COUNT, NUMERIC_FEATURES, encode  # noqa: E402


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    errors = np.abs(actual - np.clip(predicted, 2, 120))
    return {
        "mae_minutes": round(float(np.mean(errors)), 3),
        "median_absolute_error_minutes": round(float(np.median(errors)), 3),
        "p90_absolute_error_minutes": round(float(np.quantile(errors, 0.9)), 3),
    }


def add_route_history(reference: pd.DataFrame, target: pd.DataFrame) -> pd.DataFrame:
    """Add historical route statistics computed from other trips only."""
    stats = reference.groupby(["pickup_zone", "dropoff_zone"])["duration_min"].agg(["median", "count"])
    routes = pd.MultiIndex.from_frame(target[["pickup_zone", "dropoff_zone"]])
    matched = stats.reindex(routes)
    result = target.copy()
    result["route_median"] = matched["median"].fillna(reference["duration_min"].median()).to_numpy()
    result["route_count"] = matched["count"].fillna(0).to_numpy()
    return result


def add_published_route_history(target: pd.DataFrame, published_model: dict) -> pd.DataFrame:
    """Recreate the exact route features the current website would serve."""
    history = published_model["route_history"]
    result = target.copy()
    routes = [f"{pickup}-{dropoff}" for pickup, dropoff in zip(target["pickup_zone"], target["dropoff_zone"], strict=True)]
    result["route_median"] = [history[route][0] if route in history else published_model["global_median"] for route in routes]
    result["route_count"] = [history[route][1] if route in history else 0 for route in routes]
    return result


def compact_tree(node: dict) -> dict:
    if "leaf_value" in node:
        return {"v": round(float(node["leaf_value"]), 8)}
    if node.get("decision_type") != "<=":
        raise ValueError(f"Unsupported tree decision: {node.get('decision_type')}")
    return {
        "f": int(node["split_feature"]),
        "t": float(node["threshold"]),
        "l": compact_tree(node["left_child"]),
        "r": compact_tree(node["right_child"]),
    }


def run(sample_percent: int, months_override: list[str] | None, force: bool) -> int:
    links = discover_months()
    months = months_override or sorted(links)[-4:]
    if len(months) < 3:
        raise RuntimeError("Need at least three months for time-based training and validation")
    missing = [month for month in months if month not in links]
    if missing:
        raise ValueError(f"Months missing from TLC page: {missing}")
    latest = months[-1]
    metadata_path = ROOT / "site" / "metadata.json"
    if metadata_path.exists() and not force:
        published = json.loads(metadata_path.read_text())
        if latest <= published["validation_month"]:
            print(f"No new month after {published['validation_month']}; nothing to publish")
            return 0

    cache = ROOT / ".data"
    frames: list[pd.DataFrame] = []
    sources: list[dict[str, str]] = []
    for month in months:
        path = download(links[month], cache / f"yellow_tripdata_{month}.parquet")
        frame = load_month(path, month, sample_percent)
        print(f"{month}: {len(frame):,} valid sampled trips")
        frames.append(frame)
        sources.append({"month": month, "url": links[month], "sha256": sha256(path)})

    training_frames = []
    for index, frame in enumerate(frames[:-1]):
        other_months = pd.concat([other for other_index, other in enumerate(frames[:-1]) if other_index != index])
        training_frames.append(add_route_history(other_months, frame))
    train = pd.concat(training_frames, ignore_index=True)
    validation = add_route_history(pd.concat(frames[:-1], ignore_index=True), frames[-1])
    y_train = train["duration_min"].to_numpy(dtype=np.float32)
    y_validation = validation["duration_min"].to_numpy(dtype=np.float32)
    x_train = encode(train)
    x_validation = encode(validation)

    params = {
        "objective": "regression_l1",
        "metric": "l1",
        "learning_rate": 0.05,
        "num_leaves": 31,
        "max_depth": 7,
        "min_data_in_leaf": 100,
        "feature_fraction": 0.9,
        "bagging_fraction": 0.9,
        "bagging_freq": 1,
        "num_threads": 4,
        "verbosity": -1,
        "seed": 42,
    }
    candidate = lgb.train(params, lgb.Dataset(x_train, label=y_train), num_boost_round=200)
    candidate_predictions = candidate.predict(x_validation)
    candidate_metrics = metrics(y_validation, candidate_predictions)
    baseline_metrics = metrics(y_validation, validation["route_median"].to_numpy())
    print(f"Candidate: {candidate_metrics}")
    print(f"Route median baseline: {baseline_metrics}")

    if candidate_metrics["mae_minutes"] > baseline_metrics["mae_minutes"] * 1.03:
        raise RuntimeError("Candidate exceeds route-median baseline MAE by more than 3%")

    incumbent_path = ROOT / "models" / "champion.txt"
    incumbent_metrics = None
    if incumbent_path.exists():
        incumbent = lgb.Booster(model_file=str(incumbent_path))
        published_model = json.loads((ROOT / "site" / "model.json").read_text())
        incumbent_features = encode(add_published_route_history(frames[-1], published_model))
        incumbent_metrics = metrics(y_validation, incumbent.predict(incumbent_features))
        print(f"Incumbent on newest month: {incumbent_metrics}")
        if candidate_metrics["mae_minutes"] > incumbent_metrics["mae_minutes"] * 1.01:
            print("Candidate exceeds incumbent MAE by more than 1%; keeping current model")
            return 0

    model_dump = candidate.dump_model()
    trees = [compact_tree(info["tree_structure"]) for info in model_dump["tree_info"]]
    model = {
        "format": "taxi-minute-lightgbm-v1",
        "feature_count": FEATURE_COUNT,
        "numeric_features": NUMERIC_FEATURES,
        "global_median": round(float(train["duration_min"].median()), 6),
        "route_history": {
            f"{pickup}-{dropoff}": [round(float(row["median"]), 6), int(row["count"])]
            for (pickup, dropoff), row in train.groupby(["pickup_zone", "dropoff_zone"])["duration_min"]
                .agg(["median", "count"]).iterrows()
        },
        "trees": trees,
        "min_minutes": 2,
        "max_minutes": 120,
        "interval_half_width_minutes": round(
            float(np.quantile(np.abs(y_validation - np.clip(candidate_predictions, 2, 120)), 0.8)), 1
        ),
    }
    zones = zone_lookup(cache)
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    metadata = {
        "model_version": created_at,
        "trained_at_utc": created_at,
        "training_months": months[:-1],
        "validation_month": latest,
        "training_rows": len(train),
        "validation_rows": len(validation),
        "sample_percent": sample_percent,
        "metrics": candidate_metrics,
        "route_median_baseline": baseline_metrics,
        "incumbent_on_validation": incumbent_metrics,
        "source_files": sources,
    }

    (ROOT / "models").mkdir(exist_ok=True)
    candidate.save_model(str(incumbent_path))
    save_json(ROOT / "site" / "model.json", model)
    save_json(ROOT / "site" / "zones.json", zones)
    save_json(metadata_path, metadata)

    # These cases prove that browser inference matches native LightGBM output.
    cases = []
    for row, expected in zip(validation.head(20).itertuples(), candidate_predictions[:20], strict=True):
        cases.append(
            {
                "pickup_zone": int(row.pickup_zone),
                "dropoff_zone": int(row.dropoff_zone),
                "pickup_at": row.pickup_at.strftime("%Y-%m-%dT%H:%M"),
                "expected": round(float(np.clip(expected, 2, 120)), 6),
            }
        )
    save_json(ROOT / "tests" / "parity_cases.json", cases)
    print(f"Published model {created_at} using validation month {latest}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample-percent", type=int, default=8)
    parser.add_argument("--months", nargs="+", help="Use specific published months instead of latest four")
    parser.add_argument("--force", action="store_true", help="Retrain even if newest month is unchanged")
    args = parser.parse_args()
    raise SystemExit(run(args.sample_percent, args.months, args.force))
