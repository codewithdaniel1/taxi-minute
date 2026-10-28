import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makeFeatures, predict, FEATURE_COUNT } from '../site/predict.js';

const model = JSON.parse(readFileSync(new URL('../site/model.json', import.meta.url)));
const cases = JSON.parse(readFileSync(new URL('./parity_cases.json', import.meta.url)));

test('feature vector has expected size and one-hot zones', () => {
  const features = makeFeatures({ pickup_zone: 161, dropoff_zone: 132, pickup_at: '2026-10-27T09:30' });
  assert.equal(features.length, FEATURE_COUNT);
  assert.equal(features[11 + 160], 1);
  assert.equal(features[11 + 263 + 131], 1);
  assert.equal(features[1], 1); // Tuesday, Monday = 0.
});

test('browser predictions match native LightGBM', () => {
  for (const item of cases) {
    const actual = predict(model, item);
    assert.ok(Math.abs(actual - item.expected) < 0.01,
      `Prediction mismatch: ${actual} versus ${item.expected}`);
  }
});

test('invalid dates and zones are rejected', () => {
  assert.throws(() => makeFeatures({ pickup_zone: 264, dropoff_zone: 132, pickup_at: '2026-10-27T09:30' }));
  assert.throws(() => makeFeatures({ pickup_zone: 161, dropoff_zone: 132, pickup_at: '2026-02-30T09:30' }));
});
