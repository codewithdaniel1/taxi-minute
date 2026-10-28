// TLC taxi-zone polygon lookup. Coordinates are [longitude, latitude].
function onSegment(x, y, start, end) {
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  return Math.abs(cross) < 1e-10 && x >= Math.min(x1, x2) - 1e-10 &&
    x <= Math.max(x1, x2) + 1e-10 && y >= Math.min(y1, y2) - 1e-10 &&
    y <= Math.max(y1, y2) + 1e-10;
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (onSegment(lon, lat, a, b)) return true;
    if ((a[1] > lat) !== (b[1] > lat) &&
        lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function zoneForPoint(lon, lat, boundaries) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  for (const feature of boundaries.features) {
    const [west, south, east, north] = feature.bbox;
    if (lon < west || lon > east || lat < south || lat > north) continue;
    for (const polygon of feature.polygons) {
      if (inRing(lon, lat, polygon[0]) &&
          !polygon.slice(1).some(hole => inRing(lon, lat, hole))) {
        return feature.id;
      }
    }
  }
  return null;
}
