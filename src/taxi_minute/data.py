"""Discover and load public NYC TLC yellow-taxi records."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

import duckdb
import pandas as pd

TLC_PAGE = "https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page"
ZONE_CSV = "https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv"
ALLOWED_HOSTS = {"d37ci6vzurychx.cloudfront.net"}


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def discover_months() -> dict[str, str]:
    request = urllib.request.Request(TLC_PAGE, headers={"User-Agent": "Taxi-Minute/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8", errors="replace")
    parser = LinkParser()
    parser.feed(html)
    months: dict[str, str] = {}
    for link in parser.links:
        parsed = urlparse(link)
        name = Path(parsed.path).name
        if parsed.hostname not in ALLOWED_HOSTS:
            continue
        if name.startswith("yellow_tripdata_") and name.endswith(".parquet"):
            month = name.removeprefix("yellow_tripdata_").removesuffix(".parquet")
            if len(month) == 7 and month[4] == "-" and month[:4].isdigit() and month[5:].isdigit():
                months[month] = link
    if not months:
        raise RuntimeError("Could not discover yellow-taxi parquet links on the TLC page")
    return dict(sorted(months.items()))


def download(url: str, destination: Path) -> Path:
    if urlparse(url).hostname not in ALLOWED_HOSTS:
        raise ValueError(f"Unexpected data host: {url}")
    if destination.exists() and destination.stat().st_size > 0:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "Taxi-Minute/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as out:
            shutil.copyfileobj(response, out)
        if temporary.stat().st_size == 0:
            raise RuntimeError(f"Empty download: {url}")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def load_month(path: Path, month: str, sample_percent: int) -> pd.DataFrame:
    """Use a deterministic hash sample so reruns train on the same trips."""
    if not 1 <= sample_percent <= 100:
        raise ValueError("sample_percent must be between 1 and 100")
    query = """
        SELECT
            CAST(PULocationID AS INTEGER) AS pickup_zone,
            CAST(DOLocationID AS INTEGER) AS dropoff_zone,
            tpep_pickup_datetime AS pickup_at,
            date_diff('second', tpep_pickup_datetime, tpep_dropoff_datetime) / 60.0 AS duration_min
        FROM read_parquet(?)
        WHERE PULocationID BETWEEN 1 AND 263
          AND DOLocationID BETWEEN 1 AND 263
          AND strftime(tpep_pickup_datetime, '%Y-%m') = ?
          AND date_diff('second', tpep_pickup_datetime, tpep_dropoff_datetime)
              BETWEEN 120 AND 7200
          AND hash(tpep_pickup_datetime, PULocationID, DOLocationID) % 100 < ?
    """
    frame = duckdb.execute(query, [str(path), month, sample_percent]).df()
    if len(frame) < 1_000:
        raise RuntimeError(f"Too few valid rows for {month}: {len(frame)}")
    if frame[["pickup_zone", "dropoff_zone", "pickup_at", "duration_min"]].isna().any().any():
        raise RuntimeError(f"Unexpected null fields in {month}")
    return frame


def zone_lookup(cache_dir: Path) -> list[dict[str, str | int]]:
    path = download(ZONE_CSV, cache_dir / "taxi_zone_lookup.csv")
    with path.open(newline="", encoding="utf-8-sig") as stream:
        zones = [
            {"id": int(row["LocationID"]), "borough": row["Borough"], "name": row["Zone"]}
            for row in csv.DictReader(stream)
            if 1 <= int(row["LocationID"]) <= 263
        ]
    if len(zones) < 250:
        raise RuntimeError("Taxi zone lookup appears incomplete")
    return sorted(zones, key=lambda zone: (str(zone["borough"]), str(zone["name"])))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n")
