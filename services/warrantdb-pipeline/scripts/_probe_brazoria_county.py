import requests
from bs4 import BeautifulSoup

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
r = requests.get("https://brazoriacounty.net/sheriff/jail", timeout=15, headers=UA)
print(f"Status: {r.status_code}")
soup = BeautifulSoup(r.text, "html.parser")
links = soup.find_all("a", href=True)
print(f"Found {len(links)} links")
for a in links[:40]:
    print(f"  {repr(a.get_text(strip=True))[:40]}  ->  {a['href']}")

# Also check if there are any iframes or embed sources
for tag in soup.find_all(["iframe", "embed", "object"]):
    print(f"  EMBED/IFRAME: {tag.get('src') or tag.get('data')}")

# Check any JSON/script tags with URLs
import re
for script in soup.find_all("script"):
    text = script.string or ""
    for m in re.findall(r"https?://[^\s\"'<>]+", text)[:5]:
        print(f"  JS URL: {m}")
