import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { zoneForPoint } from '../site/zone-lookup.js';

const boundaries = JSON.parse(readFileSync(new URL('../site/zone-boundaries.json', import.meta.url)));

test('published boundaries cover every TLC zone exactly once', () => {
  assert.deepEqual(boundaries.features.map(feature => feature.id),
    Array.from({ length: 263 }, (_, index) => index + 1));
});

test('pins resolve to the expected taxi zones', () => {
  assert.equal(zoneForPoint(-73.9855, 40.7580, boundaries), 230); // Times Square
  assert.equal(zoneForPoint(-73.7781, 40.6413, boundaries), 132); // JFK
  assert.equal(zoneForPoint(-74.1745, 40.6895, boundaries), 1); // Newark Airport
  assert.equal(zoneForPoint(-73.9855, 41.7580, boundaries), null); // Outside coverage
});

test('holes in polygon geometry are excluded', () => {
  const withHole = { features: [{
    id: 7, bbox: [0, 0, 10, 10],
    polygons: [[
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ]],
  }] };
  assert.equal(zoneForPoint(2, 2, withHole), 7);
  assert.equal(zoneForPoint(5, 5, withHole), null);
});
