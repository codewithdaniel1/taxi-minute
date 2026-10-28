"""Training features mirrored by site/predict.js."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import sparse

NUMERIC_FEATURES = [
    "hour",
    "weekday",
    "month",
    "is_weekend",
    "same_zone",
    "pickup_zone",
    "dropoff_zone",
    "hour_sin",
    "hour_cos",
    "route_median",
    "route_count",
]
FEATURE_COUNT = len(NUMERIC_FEATURES) + 263 * 2


def encode(frame: pd.DataFrame) -> sparse.csr_matrix:
    times = pd.to_datetime(frame["pickup_at"])
    hour = times.dt.hour.to_numpy(dtype=np.float32)
    weekday = times.dt.dayofweek.to_numpy(dtype=np.float32)
    month = times.dt.month.to_numpy(dtype=np.float32)
    pickup = frame["pickup_zone"].to_numpy(dtype=np.int32)
    dropoff = frame["dropoff_zone"].to_numpy(dtype=np.int32)
    if np.any((pickup < 1) | (pickup > 263) | (dropoff < 1) | (dropoff > 263)):
        raise ValueError("Pickup and drop-off zones must be between 1 and 263")
    numeric = np.column_stack(
        [
            hour,
            weekday,
            month,
            (weekday >= 5).astype(np.float32),
            (pickup == dropoff).astype(np.float32),
            pickup.astype(np.float32),
            dropoff.astype(np.float32),
            np.sin(2 * math.pi * hour / 24),
            np.cos(2 * math.pi * hour / 24),
            frame["route_median"].to_numpy(dtype=np.float32),
            frame["route_count"].to_numpy(dtype=np.float32),
        ]
    ).astype(np.float32)
    rows = np.arange(len(frame))
    pickup_hot = sparse.csr_matrix(
        (np.ones(len(frame), dtype=np.float32), (rows, pickup - 1)), shape=(len(frame), 263)
    )
    dropoff_hot = sparse.csr_matrix(
        (np.ones(len(frame), dtype=np.float32), (rows, dropoff - 1)), shape=(len(frame), 263)
    )
    return sparse.hstack([sparse.csr_matrix(numeric), pickup_hot, dropoff_hot], format="csr")
