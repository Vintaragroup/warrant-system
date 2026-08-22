from __future__ import annotations
import os, time, re
import httpx

PRIMARY = (os.getenv("IP_GEO_PROVIDER") or "none").lower()
TOKEN   = os.getenv("IP_GEO_TOKEN") or ""
TTL_SEC = int(os.getenv("IP_GEO_TTL_SEC", "86400"))

_CACHE: dict[str, tuple[float, dict | None]] = {}

def _is_local(ip: str) -> bool:
    if not ip or ip == "::1":
        return True
    return (
        ip.startswith("127.") or ip.startswith("10.") or ip.startswith("192.168.") or
        ip.startswith("172.16.") or ip.startswith("172.17.") or ip.startswith("172.18.") or
        ip.startswith("172.19.") or ip.startswith("172.2") or ip.startswith("172.3")
    )

def _from_cache(ip: str):
    row = _CACHE.get(ip)
    if not row:
        return None
    exp, data = row
    if exp < time.time():
        _CACHE.pop(ip, None)
        return None
    return data

def _to_cache(ip: str, data: dict | None) -> None:
    _CACHE[ip] = (time.time() + TTL_SEC, data)

def _parse_asn_org(org_field: str | None):
    if not org_field:
        return None, None
    m = re.match(r'\s*(AS\d+)\s+(.*)', org_field.strip(), re.I)
    if m:
        return m.group(1), (m.group(2).strip() or None)
    return None, org_field.strip()

def _norm(lat, lon, *, accuracy_km, city, region, country, asn, org, is_vpn, is_proxy, is_relay, provider):
    if lat is None or lon is None:
        return None
    return {
        "lat": float(lat),
        "lon": float(lon),
        "accuracy_km": float(accuracy_km) if accuracy_km is not None else 25.0,
        "city": city,
        "region": region,
        "country": country,
        "asn": asn,
        "org": org,
        "is_vpn": bool(is_vpn) if is_vpn is not None else None,
        "is_proxy": bool(is_proxy) if is_proxy is not None else None,
        "is_relay": bool(is_relay) if is_relay is not None else None,
        "provider": provider,
    }

async def _lookup_ipinfo(ip: str) -> dict | None:
    url = f"https://ipinfo.io/{ip}/json"
    if TOKEN:
        url += f"?token={TOKEN}"
    timeout = httpx.Timeout(5.0, connect=3.0)
    async with httpx.AsyncClient(timeout=timeout) as c:
        r = await c.get(url)
        r.raise_for_status()
        d = r.json()
        loc_raw = d.get("loc")
        lat = lon = None
        if loc_raw and "," in loc_raw:
            try:
                a, b = loc_raw.split(",", 1)
                lat, lon = float(a), float(b)
            except Exception:
                lat = lon = None
        asn, org_name = _parse_asn_org(d.get("org"))
        p = d.get("privacy") or {}
        return _norm(
            lat, lon,
            accuracy_km=25.0,
            city=d.get("city"),
            region=d.get("region"),
            country=d.get("country"),
            asn=asn,
            org=org_name,
            is_vpn=p.get("vpn"),
            is_proxy=p.get("proxy"),
            is_relay=p.get("relay"),
            provider="ipinfo"
        )

async def _lookup_ipapi(ip: str) -> dict | None:
    url = f"https://ipapi.co/{ip}/json/"
    timeout = httpx.Timeout(5.0, connect=3.0)
    async with httpx.AsyncClient(timeout=timeout) as c:
        r = await c.get(url)
        r.raise_for_status()
        d = r.json()
        lat, lon = d.get("latitude"), d.get("longitude")
        return _norm(
            float(lat) if lat is not None else None,
            float(lon) if lon is not None else None,
            accuracy_km=30.0,
            city=d.get("city"),
            region=d.get("region"),
            country=d.get("country_name"),
            asn=d.get("asn"),
            org=d.get("org") or d.get("asn"),
            is_vpn=None,
            is_proxy=None,
            is_relay=None,
            provider="ipapi"
        )

async def ip_to_geo(ip: str) -> dict | None:
    if _is_local(ip) or PRIMARY == "none":
        return None

    cached = _from_cache(ip)
    if cached is not None:
        return cached

    providers = (("ipinfo", _lookup_ipinfo), ("ipapi", _lookup_ipapi))
    if PRIMARY == "ipapi":
        providers = (("ipapi", _lookup_ipapi), ("ipinfo", _lookup_ipinfo))

    result = None
    for _, fn in providers:
        try:
            result = await fn(ip)
            if result:
                break
        except Exception:
            continue

    _to_cache(ip, result)
    return result
