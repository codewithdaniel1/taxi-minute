"""Build browser-ready taxi-zone boundaries from the TLC's official shapefile.

Run: uv run --no-project --with pyshp --with pyproj python3 scripts/build_zone_boundaries.py
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import shapefile
from pyproj import CRS, Transformer

SOURCE = "https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip"
ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "site" / "zone-boundaries.json"


def build(archive: ZipFile) -> dict:
    prefix = "taxi_zones/taxi_zones."
    reader = shapefile.Reader(
        shp=BytesIO(archive.read(prefix + "shp")),
        shx=BytesIO(archive.read(prefix + "shx")),
        dbf=BytesIO(archive.read(prefix + "dbf")),
    )
    source_crs = CRS.from_wkt(archive.read(prefix + "prj").decode())
    to_lon_lat = Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True)
    features = []
    for record in reader.iterShapeRecords():
        zone_id = int(record.record.as_dict()["LocationID"])
        geometry = record.shape.__geo_interface__
        source_polygons = geometry["coordinates"]
        if geometry["type"] == "Polygon":
            source_polygons = [source_polygons]
        elif geometry["type"] != "MultiPolygon":
            raise ValueError(f"Unexpected geometry for zone {zone_id}: {geometry['type']}")
        polygons = []
        xs, ys = [], []
        for polygon in source_polygons:
            rings = []
            for ring in polygon:
                rounded = [[round(lon, 6), round(lat, 6)] for lon, lat in
                           (to_lon_lat.transform(x, y) for x, y in ring)]
                if len(rounded) < 4 or rounded[0] != rounded[-1]:
                    raise ValueError(f"Invalid ring for zone {zone_id}")
                xs.extend(point[0] for point in rounded)
                ys.extend(point[1] for point in rounded)
                rings.append(rounded)
            polygons.append(rings)
        features.append({
            "id": zone_id,
            "bbox": [min(xs), min(ys), max(xs), max(ys)],
            "polygons": polygons,
        })
    features.sort(key=lambda feature: feature["id"])
    if [feature["id"] for feature in features] != list(range(1, 264)):
        raise ValueError("Expected one boundary for each taxi zone ID 1–263")
    return {"source": SOURCE, "features": features}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Use a downloaded TLC zip file")
    args = parser.parse_args()
    if args.input:
        archive = ZipFile(args.input)
    else:
        request = urllib.request.Request(SOURCE, headers={"User-Agent": "Taxi-Minute/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            archive = ZipFile(BytesIO(response.read()))
    payload = build(archive)
    DESTINATION.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"Wrote {len(payload['features'])} zones to {DESTINATION}")


if __name__ == "__main__":
    main()
