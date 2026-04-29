"""
Probe the Brazoria Tyler PublicAccess portal to determine:
1. What URL paths are available (roster listing, detail pages, hidden endpoints)
2. What search parameters exist
3. Whether an empty/wildcard search returns results (potential roster enumeration)
4. Network request patterns (XHR, fetch, AJAX) in the page JS
"""
import re
import sys
import requests
from bs4 import BeautifulSoup

BASE = "https://portal-txbrazoria.tylertech.cloud/PublicAccess/"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
SEARCH_URL = BASE + "JailingSearch.aspx?ID=400"

sess = requests.Session()
sess.headers.update(UA)

print("=" * 70)
print("1. SESSION INIT")
r = sess.get(BASE + "default.aspx", timeout=30)
print(f"   default.aspx -> {r.status_code} final_url={r.url}")
print(f"   cookies: {list(sess.cookies.keys())}")

print()
print("=" * 70)
print("2. SEARCH FORM INSPECTION")
r2 = sess.get(SEARCH_URL, timeout=30)
print(f"   JailingSearch.aspx -> {r2.status_code} url={r2.url}")
soup = BeautifulSoup(r2.text, "html.parser")

# All non-hidden form inputs
for inp in soup.find_all("input"):
    name = inp.get("name", "")
    itype = inp.get("type", "text")
    val = (inp.get("value") or "")[:60]
    if name and name not in ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"):
        print(f"   INPUT name={name!r:40s} type={itype!r:12s} value={val!r}")

for sel in soup.find_all("select"):
    opts = [o.get_text(strip=True) for o in sel.find_all("option")]
    print(f"   SELECT name={sel.get('name', '')!r} options={opts}")

# Check JavaScript for fetch/XHR/AJAX patterns
scripts = [s.string or "" for s in soup.find_all("script") if s.string]
all_js = "\n".join(scripts)
print()
print("3. JAVASCRIPT URL/ENDPOINT PATTERNS")
for pattern in [
    r"fetch\(['\"]([^'\"]+)['\"]",
    r"XMLHttpRequest",
    r"\.ajax\(",
    r"url\s*:\s*['\"]([^'\"]+)['\"]",
    r"getJSON\(['\"]([^'\"]+)['\"]",
    r"/PublicAccess/[A-Za-z]+\.aspx[^'\"]*",
    r"handler\.ashx",
    r"\.svc",
    r"api/",
]:
    matches = re.findall(pattern, all_js, re.I)
    if matches:
        print(f"   {pattern}: {matches[:5]}")

# Linked scripts
print()
print("4. LINKED SCRIPTS / RESOURCES")
for tag in soup.find_all("script", src=True):
    print(f"   <script src={tag['src']!r}>")

print()
print("=" * 70)
print("5. WILDCARD / EMPTY NAME SEARCH TEST")

def get_viewstate(html):
    s = BeautifulSoup(html, "html.parser")
    def v(name):
        t = s.find("input", {"name": name})
        return t["value"] if t and t.get("value") else ""
    return v("__VIEWSTATE"), v("__VIEWSTATEGENERATOR"), v("__EVENTVALIDATION"), v("NodeID")

vs, vsg, ev, nid = get_viewstate(r2.text)

# Test 1: search with empty first name (Tyler should reject)
test_cases = [
    ("SMITH", "",          "last-only (should reject)"),
    ("S",     "J",         "single-letter first+last"),
    ("",      "",          "completely empty"),
]

for lname, fname, label in test_cases:
    payload = {
        "__EVENTTARGET": "",
        "__EVENTARGUMENT": "",
        "__VIEWSTATE": vs,
        "__VIEWSTATEGENERATOR": vsg,
        "__EVENTVALIDATION": ev,
        "RadioSearchType": "1",
        "BookingNumber": "",
        "LastName": lname,
        "FirstName": fname,
        "MiddleName": "",
        "DateOfBirth": "",
        "DateBookingOnAfter": "",
        "DateBookingOnBefore": "",
        "DateReleasedOnAfter": "",
        "DateReleasedOnBefore": "",
        "BondStatusType": "0",
        "DatePostedOnAfter": "",
        "DatePostedOnBefore": "",
        "SearchSubmit": "Search",
        "SearchType": "PARTYNAME",
        "NameTypeKy": "ALIAS",
        "BaseConnKy": "",
        "ShowInactive": "",
        "StatusType": "",
        "AllStatusTypes": "",
        "BondCompany": "",
        "NodeID": nid,
        "ProductType": "",
        "SearchParams": "",
    }
    hdrs = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://portal-txbrazoria.tylertech.cloud",
        "Referer": SEARCH_URL,
    }
    try:
        resp = sess.post(SEARCH_URL, data=payload, headers=hdrs, timeout=30)
        is_error = "ErrorOccured" in resp.url or "Public Access Error" in resp.text
        # Count result rows
        rsoup = BeautifulSoup(resp.text, "html.parser")
        links = rsoup.find_all("a", href=re.compile(r"JailingDetail", re.I))
        print(f"   {label!r:40s} -> status={resp.status_code} error={is_error} result_links={len(links)} url={resp.url}")
    except Exception as exc:
        print(f"   {label!r:40s} -> EXCEPTION: {exc}")

print()
print("=" * 70)
print("6. BOOKING NUMBER SEARCH TEST")
# Try searching by booking number alone
payload_bn = dict(payload)
payload_bn.update({
    "RadioSearchType": "2",
    "BookingNumber": "B000001",
    "LastName": "",
    "FirstName": "",
    "SearchType": "BOOKINGNO",
})
try:
    resp_bn = sess.post(SEARCH_URL, data=payload_bn, headers=hdrs, timeout=30)
    rsoup = BeautifulSoup(resp_bn.text, "html.parser")
    links = rsoup.find_all("a", href=re.compile(r"JailingDetail", re.I))
    is_error = "ErrorOccured" in resp_bn.url or "Public Access Error" in resp_bn.text
    print(f"   BookingNumber=B000001 -> status={resp_bn.status_code} error={is_error} results={len(links)}")
    # Print any visible form error message
    err_msg = rsoup.find(id="lblError") or rsoup.find(class_="error") or rsoup.find(class_="ErrorText")
    if err_msg:
        print(f"   Error message: {err_msg.get_text(strip=True)!r}")
except Exception as exc:
    print(f"   EXCEPTION: {exc}")

print()
print("=" * 70)
print("7. ADDITIONAL URL PATHS ON SAME HOST")
test_paths = [
    "JailRoster.aspx",
    "InmateSearch.aspx",
    "JailSearch.aspx",
    "Roster.aspx",
    "api/jail",
    "api/inmates",
    "JailingDetail.aspx",
    "jqHandler.ashx",
    "handler.ashx",
]
for path in test_paths:
    try:
        r = sess.get(BASE + path, timeout=10, allow_redirects=False)
        print(f"   {path!r:35s} -> {r.status_code}")
    except Exception as exc:
        print(f"   {path!r:35s} -> ERROR: {exc}")
