import { predict } from './predict.js';
import { zoneForPoint } from './zone-lookup.js';

const KINDS = ['pickup', 'dropoff'];
const SEARCH_URL = 'https://geosearch.planninglabs.nyc/v2/';
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const form = document.querySelector('#prediction-form');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const dateInput = document.querySelector('#departure');
const manualZones = document.querySelector('#manual-zones');
const fields = Object.fromEntries(KINDS.map(kind => [kind, {
  input: document.querySelector(`#${kind}-address`),
  suggestions: document.querySelector(`#${kind}-suggestions`),
  match: document.querySelector(`#${kind}-match`),
  select: document.querySelector(`#${kind}-zone`),
  action: document.querySelector(`#place-${kind}`),
}]));

const state = {
  model: null, boundaries: null, zones: new Map(), map: null,
  activeKind: 'pickup',
  selections: { pickup: null, dropoff: null },
  markers: { pickup: null, dropoff: null },
  highlights: { pickup: null, dropoff: null },
  line: null,
  searchTimers: { pickup: null, dropoff: null },
  searchRequests: { pickup: null, dropoff: null },
};

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

function setMode(kind) {
  state.activeKind = kind;
  for (const item of KINDS) {
    const active = item === kind;
    fields[item].action.classList.toggle('is-active', active);
    fields[item].action.setAttribute('aria-pressed', String(active));
  }
  document.querySelector('#map-guide-text').textContent =
    `Click the map to place your ${kind === 'pickup' ? 'pickup' : 'drop-off'} pin`;
}

function updateReady() {
  document.querySelector('#estimate-button').disabled =
    !state.model || !state.selections.pickup || !state.selections.dropoff;
  result.hidden = true;
}

function closeSuggestions(kind) {
  const field = fields[kind];
  field.suggestions.hidden = true;
  field.suggestions.replaceChildren();
  field.input.setAttribute('aria-expanded', 'false');
}

function refreshLine() {
  if (!state.map) return;
  if (state.line) state.map.removeLayer(state.line);
  const start = state.selections.pickup?.point;
  const end = state.selections.dropoff?.point;
  state.line = start && end ? L.polyline(
    [[start.lat, start.lon], [end.lat, end.lon]],
    { color: '#294f5c', weight: 3, opacity: .65, dashArray: '5 9', interactive: false }
  ).addTo(state.map) : null;
}

function refreshHighlight(kind) {
  if (!state.map || !state.boundaries) return;
  if (state.highlights[kind]) state.map.removeLayer(state.highlights[kind]);
  const zoneId = state.selections[kind]?.zoneId;
  const feature = state.boundaries.features.find(item => item.id === zoneId);
  state.highlights[kind] = feature ? L.geoJSON({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: feature.polygons },
  }, {
    style: {
      color: kind === 'pickup' ? '#247e9c' : '#da743e',
      weight: 2, fillOpacity: .13, interactive: false,
    },
  }).addTo(state.map) : null;
}

function clearLocation(kind, keepInput = false) {
  const field = fields[kind];
  state.selections[kind] = null;
  if (!keepInput) field.input.value = '';
  field.select.value = '';
  field.match.textContent = 'Search an address or place a pin.';
  field.match.className = 'field-match';
  if (state.markers[kind] && state.map) state.map.removeLayer(state.markers[kind]);
  state.markers[kind] = null;
  refreshHighlight(kind);
  refreshLine();
  updateReady();
}

function showPin(kind, lon, lat) {
  if (!state.map) return;
  const marker = state.markers[kind];
  if (marker) {
    marker.setLatLng([lat, lon]);
    return;
  }
  const icon = L.divIcon({
    className: `taxi-pin taxi-pin--${kind}`,
    html: `<span><b>${kind === 'pickup' ? 'A' : 'B'}</b></span>`,
    iconSize: [36, 36], iconAnchor: [18, 36],
  });
  state.markers[kind] = L.marker([lat, lon], { icon, draggable: true })
    .on('dragend', event => {
      const point = event.target.getLatLng();
      setPoint(kind, point.lng, point.lat, 'Pinned location', false);
    }).addTo(state.map);
}

function setPoint(kind, lon, lat, label, focusMap = true) {
  const field = fields[kind];
  closeSuggestions(kind);
  showPin(kind, lon, lat);
  const zoneId = state.boundaries && zoneForPoint(lon, lat, state.boundaries);
  if (!zoneId || !state.zones.has(zoneId)) {
    state.selections[kind] = null;
    field.select.value = '';
    field.input.value = label;
    field.match.textContent = 'Outside supported taxi zones. Move the pin or choose a zone below.';
    field.match.className = 'field-match is-error';
    status.textContent = 'Choose a location inside a supported taxi zone.';
    refreshHighlight(kind);
    refreshLine();
    updateReady();
    return;
  }
  const zone = state.zones.get(zoneId);
  state.selections[kind] = { zoneId, point: { lon, lat }, label };
  field.select.value = String(zoneId);
  field.input.value = label === 'Pinned location' ? `Pinned in ${zone.name}` : label;
  field.match.textContent = `Matched to ${zone.name}, ${zone.borough} · TLC zone ${zoneId}`;
  field.match.className = 'field-match is-valid';
  status.textContent = 'Location matched to a taxi zone.';
  refreshHighlight(kind);
  refreshLine();
  updateReady();
  if (focusMap && state.map) {
    const other = state.selections[kind === 'pickup' ? 'dropoff' : 'pickup']?.point;
    if (other) {
      state.map.fitBounds([[lat, lon], [other.lat, other.lon]],
        { padding: [65, 65], maxZoom: 14, animate: false });
    } else {
      state.map.setView([lat, lon], 14, { animate: false });
    }
  }
  if (kind === 'pickup' && !state.selections.dropoff) setMode('dropoff');
  if (kind === 'dropoff' && !state.selections.pickup) setMode('pickup');
}

function selectManualZone(kind) {
  const field = fields[kind];
  const zoneId = Number(field.select.value);
  clearTimeout(state.searchTimers[kind]);
  state.searchRequests[kind]?.abort();
  closeSuggestions(kind);
  clearLocation(kind);
  if (!zoneId || !state.zones.has(zoneId)) return;
  const zone = state.zones.get(zoneId);
  state.selections[kind] = { zoneId, point: null, label: `${zone.name} zone` };
  field.select.value = String(zoneId);
  field.match.textContent = `${zone.name}, ${zone.borough} · TLC zone ${zoneId} (manual)`;
  field.match.className = 'field-match is-valid';
  status.textContent = 'Taxi zone selected.';
  refreshHighlight(kind);
  refreshLine();
  updateReady();
  if (state.map && state.boundaries) {
    const feature = state.boundaries.features.find(item => item.id === zoneId);
    const [west, south, east, north] = feature.bbox;
    state.map.fitBounds([[south, west], [north, east]],
      { padding: [45, 45], maxZoom: 13, animate: false });
  }
}

function showSuggestions(kind, features) {
  const field = fields[kind];
  const list = field.suggestions;
  list.replaceChildren();
  const valid = features.filter(item => item?.properties?.label &&
    item?.geometry?.type === 'Point' &&
    item.geometry.coordinates?.length >= 2);
  if (!valid.length) {
    const message = document.createElement('p');
    message.textContent = 'No address found. Try another search or place a pin.';
    list.append(message);
  }
  for (const item of valid.slice(0, 5)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.textContent = item.properties.label;
    button.addEventListener('click', () => {
      const [lon, lat] = item.geometry.coordinates;
      setPoint(kind, lon, lat, item.properties.label);
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeSuggestions(kind);
        field.input.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...list.querySelectorAll('button')];
        const index = buttons.indexOf(button);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
    });
    list.append(button);
  }
  list.hidden = false;
  field.input.setAttribute('aria-expanded', 'true');
}

function queueSearch(kind, event) {
  const field = fields[kind];
  clearTimeout(state.searchTimers[kind]);
  state.searchRequests[kind]?.abort();
  closeSuggestions(kind);
  if (state.selections[kind] || state.markers[kind]) clearLocation(kind, true);
  const query = field.input.value.trim();
  if (query.length < 3) return;
  state.searchTimers[kind] = setTimeout(async () => {
    const controller = new AbortController();
    state.searchRequests[kind] = controller;
    const url = new URL(event.inputType === 'insertFromPaste' ? 'search' : 'autocomplete', SEARCH_URL);
    url.searchParams.set('text', query);
    url.searchParams.set('size', '5');
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Address service returned ${response.status}`);
      const matches = await response.json();
      if (state.searchRequests[kind] !== controller || field.input.value.trim() !== query) return;
      showSuggestions(kind, matches.features ?? []);
    } catch (error) {
      if (error.name === 'AbortError') return;
      field.match.textContent = 'Address search is unavailable. Place a pin or choose a zone below.';
      field.match.className = 'field-match is-error';
      manualZones.open = true;
    }
  }, 400);
}

function initializeMap() {
  if (!globalThis.L) {
    document.querySelector('#map-unavailable').hidden = false;
    document.querySelector('#map-guide-text').textContent = 'Map unavailable. Search an address or use taxi zones.';
    manualZones.open = true;
    for (const kind of KINDS) fields[kind].action.disabled = true;
    return;
  }
  state.map = L.map('map', { zoomControl: false, scrollWheelZoom: false })
    .setView([40.733, -73.94], 11);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  let tileFailures = 0;
  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).on('tileerror', () => {
    tileFailures += 1;
    if (tileFailures >= 3) {
      document.querySelector('#map-unavailable').hidden = false;
      manualZones.open = true;
    }
  }).addTo(state.map);
  state.map.on('click', event => {
    if (!state.boundaries) return;
    setPoint(state.activeKind, event.latlng.lng, event.latlng.lat, 'Pinned location', false);
  });
}

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

async function initialize() {
  try {
    const [core, boundaries] = await Promise.all([
      Promise.all(['./model.json', './zones.json', './metadata.json'].map(loadJSON)),
      loadJSON('./zone-boundaries.json').catch(() => null),
    ]);
    const [model, zones, metadata] = core;
    state.model = model;
    state.boundaries = boundaries?.features?.length === 263 ? boundaries : null;
    state.zones = new Map(zones.map(zone => [zone.id, zone]));
    for (const kind of KINDS) populate(fields[kind].select, zones);
    dateInput.value = localNYCDateTime();
    document.querySelector('#model-date').textContent = metadata.validation_month;
    document.querySelector('#model-mae').textContent = `${metadata.metrics.mae_minutes.toFixed(1)} min`;
    document.querySelector('#model-rows').textContent = metadata.validation_rows.toLocaleString();
    initializeMap();
    if (!state.boundaries) {
      manualZones.open = true;
      for (const kind of KINDS) {
        fields[kind].input.disabled = true;
        fields[kind].action.disabled = true;
      }
      document.querySelector('#map-guide-text').textContent =
        'Taxi-zone boundaries unavailable. Choose zones in the planner.';
      status.textContent = 'Taxi-zone map data is unavailable. Choose zones below.';
    } else {
      status.textContent = 'Choose pickup and drop-off locations.';
    }
    updateReady();
  } catch (error) {
    status.textContent = `Could not load the predictor: ${error.message}`;
    manualZones.open = true;
  }
}

for (const kind of KINDS) {
  const field = fields[kind];
  field.action.addEventListener('click', () => setMode(kind));
  field.select.addEventListener('change', () => selectManualZone(kind));
  field.input.addEventListener('input', event => queueSearch(kind, event));
  field.input.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSuggestions(kind);
    if (event.key === 'ArrowDown' && !field.suggestions.hidden) {
      const first = field.suggestions.querySelector('button');
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
}
document.addEventListener('click', event => {
  for (const kind of KINDS) {
    if (!document.querySelector(`#${kind}-field`).contains(event.target)) closeSuggestions(kind);
  }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!state.model || !state.selections.pickup || !state.selections.dropoff) return;
  try {
    const pickup = state.selections.pickup.zoneId;
    const dropoff = state.selections.dropoff.zoneId;
    const minutes = predict(state.model, {
      pickup_zone: pickup, dropoff_zone: dropoff, pickup_at: dateInput.value,
    });
    const halfWidth = state.model.interval_half_width_minutes;
    const history = state.model.route_history[`${pickup}-${dropoff}`];
    document.querySelector('#estimate').textContent = Math.round(minutes);
    document.querySelector('#range').textContent =
      `${Math.max(2, Math.round(minutes - halfWidth))}–${Math.min(120, Math.round(minutes + halfWidth))} min`;
    document.querySelector('#matched-route').textContent =
      `${state.zones.get(pickup).name} → ${state.zones.get(dropoff).name} (taxi zones)`;
    document.querySelector('#route-note').textContent = history && history[1] >= 30
      ? '' : 'Few historical trips match this zone pair. Treat the estimate with extra caution.';
    result.hidden = false;
    status.textContent = 'Estimate updated.';
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (error) {
    result.hidden = true;
    status.textContent = error.message;
  }
});

initialize();
