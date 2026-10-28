import { predict } from './predict.js';

const form = document.querySelector('#prediction-form');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const pickupSelect = document.querySelector('#pickup-zone');
const dropoffSelect = document.querySelector('#dropoff-zone');
const dateInput = document.querySelector('#departure');
let model;

function localNYCDateTime() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function populate(select, zones) {
  const boroughs = [...new Set(zones.map(zone => zone.borough))].sort();
  for (const borough of boroughs) {
    const group = document.createElement('optgroup');
    group.label = borough;
    for (const zone of zones.filter(item => item.borough === borough)) {
      const option = document.createElement('option');
      option.value = zone.id;
      option.textContent = zone.name;
      group.append(option);
    }
    select.append(group);
  }
}

async function initialize() {
  try {
    const responses = await Promise.all([
      fetch('./model.json'), fetch('./zones.json'), fetch('./metadata.json'),
    ]);
    if (responses.some(response => !response.ok)) throw new Error('Model files are missing.');
    const [loadedModel, zones, metadata] = await Promise.all(responses.map(response => response.json()));
    model = loadedModel;
    populate(pickupSelect, zones);
    populate(dropoffSelect, zones);
    pickupSelect.value = '161'; // Midtown Center
    dropoffSelect.value = '132'; // JFK Airport
    dateInput.value = localNYCDateTime();
    document.querySelector('#model-date').textContent = metadata.validation_month;
    document.querySelector('#model-mae').textContent = `${metadata.metrics.mae_minutes.toFixed(1)} min`;
    document.querySelector('#model-rows').textContent = metadata.validation_rows.toLocaleString();
    form.querySelector('button').disabled = false;
    status.textContent = 'Ready to estimate.';
  } catch (error) {
    status.textContent = `Could not load the predictor: ${error.message}`;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const minutes = predict(model, {
      pickup_zone: pickupSelect.value,
      dropoff_zone: dropoffSelect.value,
      pickup_at: dateInput.value,
    });
    const halfWidth = model.interval_half_width_minutes;
    const history = model.route_history[`${pickupSelect.value}-${dropoffSelect.value}`];
    document.querySelector('#estimate').textContent = Math.round(minutes);
    document.querySelector('#range').textContent =
      `${Math.max(2, Math.round(minutes - halfWidth))}–${Math.min(120, Math.round(minutes + halfWidth))} min`;
    document.querySelector('#route-note').textContent = history && history[1] >= 30
      ? '' : 'Few historical trips match this zone pair; treat this estimate with extra caution.';
    result.hidden = false;
    status.textContent = 'Estimate updated.';
  } catch (error) {
    result.hidden = true;
    status.textContent = error.message;
  }
});

initialize();
