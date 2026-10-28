// Feature order must match src/taxi_minute/features.py.
export const NUMERIC_COUNT = 11;
export const FEATURE_COUNT = NUMERIC_COUNT + 263 * 2;

export function makeFeatures({ pickup_zone, dropoff_zone, pickup_at }, model) {
  const pickup = Number(pickup_zone);
  const dropoff = Number(dropoff_zone);
  if (!Number.isInteger(pickup) || pickup < 1 || pickup > 263 ||
      !Number.isInteger(dropoff) || dropoff < 1 || dropoff > 263) {
    throw new Error('Choose valid pickup and drop-off zones.');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(pickup_at);
  if (!match) throw new Error('Choose a departure date and time.');
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || hour > 23 || minute > 59) {
    throw new Error('Choose a valid departure date and time.');
  }
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0.
  const route = model?.route_history?.[`${pickup}-${dropoff}`];
  const routeMedian = route ? route[0] : (model?.global_median ?? 15);
  const routeCount = route ? route[1] : 0;
  const features = new Float32Array(FEATURE_COUNT);
  features.set([
    hour, weekday, month, Number(weekday >= 5), Number(pickup === dropoff),
    pickup, dropoff, Math.sin(2 * Math.PI * hour / 24),
    Math.cos(2 * Math.PI * hour / 24), routeMedian, routeCount,
  ]);
  features[NUMERIC_COUNT + pickup - 1] = 1;
  features[NUMERIC_COUNT + 263 + dropoff - 1] = 1;
  return features;
}

export function predict(model, input) {
  if (model.format !== 'taxi-minute-lightgbm-v1' || model.feature_count !== FEATURE_COUNT) {
    throw new Error('The published model format is not supported by this site.');
  }
  const features = makeFeatures(input, model);
  let total = 0;
  for (const tree of model.trees) {
    let node = tree;
    while (node.v === undefined) {
      node = features[node.f] <= node.t ? node.l : node.r;
    }
    total += node.v;
  }
  return Math.max(model.min_minutes, Math.min(model.max_minutes, total));
}
