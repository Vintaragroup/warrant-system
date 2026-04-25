import { useEffect, useMemo, useRef, useState } from 'react';

// Small inline OSM map with a pinned marker for an address using Nominatim for geocoding.
// No external React map deps; renders an iframe to OpenStreetMap's embed with a bbox and marker.
// Shows a lightweight overlay tooltip with the address on hover.
// Simple in-memory cache for geocode lookups in this session
const GEO_CACHE = new Map(); // key: address string -> { lat, lon }
const LS_PREFIX = 'geo_cache_v1:';
const LS_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function lsKeyFor(q) {
  try {
    return `${LS_PREFIX}${encodeURIComponent(String(q || ''))}`;
  } catch {
    return `${LS_PREFIX}${String(q || '')}`;
  }
}

function readFromStorage(q) {
  try {
    const key = lsKeyFor(q);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const { lat, lon, ts } = obj;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    if (typeof ts === 'number' && ts > 0 && Date.now() - ts > LS_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return { lat, lon };
  } catch {
    return null;
  }
}

function writeToStorage(q, coords) {
  try {
    const key = lsKeyFor(q);
    const payload = { lat: Number(coords.lat), lon: Number(coords.lon), ts: Date.now() };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    void err;
  }
}

export default function InlineMapEmbed({ addressText, height = 180, zoom = 16, onResolvedAddress }) {
  const [coords, setCoords] = useState(null); // { lat, lon }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lastQueryRef = useRef('');
  const lastTriedRef = useRef([]); // debug: the list of variants tried
  const [refreshKey, setRefreshKey] = useState(0); // force reload of iframe to recenter
  const lastReportedRef = useRef({ q: '', postalCode: '' });
  const resolvedCallbackRef = useRef(onResolvedAddress);

  useEffect(() => {
    resolvedCallbackRef.current = onResolvedAddress;
  }, [onResolvedAddress]);

  const query = useMemo(() => {
    const raw = String(addressText || '').trim();
    if (!raw || raw === '—') return '';
    return raw;
  }, [addressText]);

  useEffect(() => {
    let cancel = false;
    // Build a set of progressively simpler query variants to improve hit rate
    function buildVariants(raw) {
      const out = new Set();
      const s0 = String(raw || '').trim();
      if (!s0) return [];
      // Strip common unit tokens (apt, ste, unit, #)
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
      // Re-join normalized parts (drop obvious line2 middle chunks when >= 4 parts)
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
      // 1) Try Nominatim
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const first = Array.isArray(data) && data.length ? data[0] : null;
          if (first?.lat && first?.lon) {
            const addr = first?.address || {};
            const components = {
              city: addr.city || addr.town || addr.village || addr.hamlet || '',
              stateCode: addr.state_code || '',
              postalCode: addr.postcode || '',
            };
            return { lat: Number(first.lat), lon: Number(first.lon), components };
          }
        }
      } catch (err) {
        void err;
      }
      // 2) Fallback: US Census Geocoder (US-only)
      try {
        const url2 = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=2020&format=json`;
        const res2 = await fetch(url2);
        if (res2.ok) {
          const data2 = await res2.json();
          const match = data2?.result?.addressMatches?.[0];
          if (match?.coordinates?.y != null && match?.coordinates?.x != null) {
            const comp = match?.addressComponents || {};
            const components = {
              city: comp.city || '',
              stateCode: comp.state || '',
              postalCode: comp.zip || '',
            };
            return { lat: Number(match.coordinates.y), lon: Number(match.coordinates.x), components };
          }
        }
      } catch (err) {
        void err;
      }
      return null;
    }

    async function geocode(q) {
      if (!q) {
        setCoords(null);
        setError('');
        return;
      }
      if (q === lastQueryRef.current) return; // basic memo guard
      // Build progressive variants and try cache for any of them first
      const variants = buildVariants(q);
      lastTriedRef.current = variants;
      for (const v of variants) {
        const mem = GEO_CACHE.get(v);
        if (mem) {
          setCoords(mem);
          setError('');
          lastQueryRef.current = v;
          return;
        }
        const stored = readFromStorage(v);
        if (stored) {
          GEO_CACHE.set(v, stored);
          setCoords(stored);
          setError('');
          lastQueryRef.current = v;
          return;
        }
      }
      setLoading(true);
      setError('');
      try {
        // Try each variant in order until one returns a coordinate
        let found = null;
        for (const v of variants) {
          const res = await tryGeocodeOnce(v);
          if (res) {
            found = { ...res, _variant: v };
            break;
          }
        }
        if (!cancel) {
          if (found) {
            setCoords(found);
            GEO_CACHE.set(found._variant || q, found);
            writeToStorage(found._variant || q, found);
            lastQueryRef.current = found._variant || q;
            try {
              const postal = String(found?.components?.postalCode || '').trim();
              const currentQ = found._variant || q;
              const callback = resolvedCallbackRef.current;
              if (typeof callback === 'function') {
                // Avoid spamming the same report for the same query+zip
                const last = lastReportedRef.current || {};
                if (last.q !== currentQ || last.postalCode !== postal) {
                  lastReportedRef.current = { q: currentQ, postalCode: postal };
                  callback({
                    coords: { lat: found.lat, lon: found.lon },
                    components: {
                      city: found?.components?.city || '',
                      stateCode: found?.components?.stateCode || '',
                      postalCode: postal,
                    },
                    queryTried: currentQ,
                    tried: lastTriedRef.current,
                    provider: found?.components?.stateCode ? 'census' : 'nominatim',
                  });
                }
              }
            } catch (err) {
              void err;
            }
          } else {
            setCoords(null);
            setError('No results');
          }
        }
      } catch (e) {
        if (!cancel) {
          setCoords(null);
          setError(e?.message || 'Geocode error');
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    // Debounce a bit
    const t = setTimeout(() => geocode(query), 300);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [query]);

  const iframeSrc = useMemo(() => {
    if (!coords) return '';
    const { lat, lon } = coords;
    // Small bbox around the point (~300m at mid-latitudes)
    const dLat = 0.0025;
    const dLon = 0.0025;
    const left = lon - dLon;
    const right = lon + dLon;
    const top = lat + dLat;
    const bottom = lat - dLat;
    const base = `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lon}&zoom=${zoom}`;
    // Append a cache-busting param so 'Recenter' can reload the view to the original bounds
    return `${base}&_=${refreshKey}`;
  }, [coords, zoom, refreshKey]);

  if (!query) return null;

  return (
    <div className="group mt-2 relative overflow-hidden rounded-lg border border-slate-200">
      {iframeSrc ? (
        <>
          <iframe
            title="map"
            src={iframeSrc}
            style={{ width: '100%', height: `${height}px`, border: 0 }}
          />
          {/* Hover overlay tooltip with address */}
          <div className="pointer-events-none absolute left-2 top-2 hidden rounded bg-black/70 px-2 py-1 text-xs text-white md:block group-hover:block">
            {addressText}
          </div>
          {/* Recenter control */}
          <button
            type="button"
            onClick={() => setRefreshKey((n) => n + 1)}
            className="absolute right-2 top-2 rounded bg-white/90 px-2 py-0.5 text-xs text-slate-700 shadow hover:bg-white"
            aria-label="Recenter map"
          >
            Recenter
          </button>
        </>
      ) : (
        <div className="flex h-[180px] items-center justify-center bg-slate-50 text-xs text-slate-500">
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
      {/* Footer link to open full map */}
      {coords ? (
        <div className="absolute bottom-1 right-1">
          <a
            className="rounded bg-white/90 px-2 py-0.5 text-xs text-slate-700 shadow hover:bg-white"
            href={`https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lon}#map=${zoom}/${coords.lat}/${coords.lon}`}
            target="_blank" rel="noreferrer"
          >
            Open full map
          </a>
        </div>
      ) : null}
    </div>
  );
}
