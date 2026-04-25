import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import marker2x from 'leaflet/dist/images/marker-icon-2x.png';
import marker from 'leaflet/dist/images/marker-icon.png';
import shadow from 'leaflet/dist/images/marker-shadow.png';

// Configure default marker icon paths for bundlers (Vite)
L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2x,
  iconUrl: marker,
  shadowUrl: shadow,
});

// Progressive geocoding of an address string using Nominatim with a US Census fallback,
// trying simplified variants for higher hit rate.
function buildVariants(raw) {
  const out = new Set();
  const s0 = String(raw || '').trim();
  if (!s0) return [];
  const stripUnit = (txt) => txt
    .replace(/\b(?:apt|apartment|unit|ste|suite|fl|floor|bldg|building|#)\s*[A-Za-z0-9-]*\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .trim();
  const s1 = stripUnit(s0);
  const parts = s1.split(',').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const city = parts.length >= 2 ? parts[parts.length - 2] : '';
  const stateMatch = last.match(/\b([A-Za-z]{2})\b/);
  const st = stateMatch ? stateMatch[1].toUpperCase() : '';
  const zipMatch = last.match(/\b(\d{5}(?:-\d{4})?)\b/);
  const zip = zipMatch ? zipMatch[1] : '';

  const push = (v) => { const t = String(v || '').trim(); if (t) out.add(t); };
  push(s0);
  if (s1 !== s0) push(s1);
  if (parts.length >= 4) {
    push([parts[0], parts[parts.length - 2], parts[parts.length - 1]].join(', '));
  }
  push(parts.join(', '));
  if (city && st && zip) push(`${city}, ${st} ${zip}`);
  if (city && st) push(`${city}, ${st}`);
  if (zip) push(zip);
  if (st) push(st);
  return Array.from(out);
}

async function tryGeocodeOnce(q) {
  // 1) Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=0`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const first = Array.isArray(data) && data.length ? data[0] : null;
      if (first?.lat && first?.lon) {
        return { lat: Number(first.lat), lon: Number(first.lon) };
      }
    }
  } catch (err) {
    void err;
  }
  // 2) US Census fallback
  try {
    const url2 = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=2020&format=json`;
    const res2 = await fetch(url2);
    if (res2.ok) {
      const data2 = await res2.json();
      const match = data2?.result?.addressMatches?.[0];
      if (match?.coordinates?.y != null && match?.coordinates?.x != null) {
        return { lat: Number(match.coordinates.y), lon: Number(match.coordinates.x) };
      }
    }
  } catch (err) {
    void err;
  }
  return null;
}

const GEO_CACHE = new Map(); // key -> { lat, lon }

export default function InlineMapLeaflet({ addressText, height = 180, zoom = 16 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const triedRef = useRef([]);

  const query = useMemo(() => {
    const raw = String(addressText || '').trim();
    if (!raw || raw === '—') return '';
    return raw;
  }, [addressText]);

  // Geocode progressively
  useEffect(() => {
    let cancel = false;
    async function go() {
      if (!query) { setCoords(null); setError(''); return; }
      if (GEO_CACHE.has(query)) { setCoords(GEO_CACHE.get(query)); setError(''); return; }
      const variants = buildVariants(query);
      triedRef.current = variants;
      setLoading(true); setError('');
      let found = null;
      for (const v of variants) {
        if (GEO_CACHE.has(v)) { found = GEO_CACHE.get(v); break; }
        const res = await tryGeocodeOnce(v);
        if (res) { found = res; GEO_CACHE.set(v, res); break; }
        if (cancel) return;
      }
      if (!cancel) {
        if (found) { setCoords(found); } else { setCoords(null); setError('No results'); }
        setLoading(false);
      }
    }
    const t = setTimeout(go, 200);
    return () => { cancel = true; clearTimeout(t); };
  }, [query]);

  // Initialize and update Leaflet map
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!coords) return;

    if (!mapRef.current) {
      const map = L.map(el, {
        zoomControl: false,
        attributionControl: false,
      });
      // CartoDB Positron tiles (Google-like light look)
      const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors, &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
      });
      tiles.addTo(map);
      // Zoom controls top-right (closer to Google feel)
      L.control.zoom({ position: 'topright' }).addTo(map);
      // Required attribution bottom-left
      L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
      mapRef.current = map;
      // Ensure proper sizing when first shown
      setTimeout(() => map.invalidateSize(), 50);
    }

    const map = mapRef.current;
    const { lat, lon } = coords;
    const ll = L.latLng(lat, lon);
    map.setView(ll, zoom, { animate: false });
    if (!markerRef.current) {
      markerRef.current = L.marker(ll).addTo(map);
    } else {
      markerRef.current.setLatLng(ll);
    }
  }, [coords, zoom]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
    }
  }, []);

  if (!query) return null;

  return (
    <div className="group mt-2 relative overflow-hidden rounded-xl border border-slate-200 shadow-sm">
      {/* Address pill overlay */}
      <div className="pointer-events-none absolute left-2 top-2 hidden rounded-full bg-black/65 px-2.5 py-1 text-xs text-white md:block group-hover:block">{addressText}</div>

      {/* Map container */}
      <div ref={containerRef} style={{ width: '100%', height: `${height}px` }} />

      {/* Fallback UI when no coords */}
      {!coords && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-xs text-slate-500">
          <div className="flex flex-col items-center gap-1">
            <div>{loading ? 'Locating…' : error || 'Map unavailable'}</div>
            {!loading && (
              <a
                className="text-blue-600 hover:underline"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText || '')}`}
                target="_blank" rel="noreferrer"
              >
                Open in Google Maps
              </a>
            )}
          </div>
        </div>
      )}

      {/* Open in OSM full map */}
      {coords && (
        <div className="absolute bottom-1 right-1">
          <a
            className="rounded bg-white/90 px-2 py-0.5 text-xs text-slate-700 shadow hover:bg-white"
            href={`https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lon}#map=${zoom}/${coords.lat}/${coords.lon}`}
            target="_blank" rel="noreferrer"
          >
            Open full map
          </a>
        </div>
      )}
    </div>
  );
}
