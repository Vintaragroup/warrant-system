import axios from 'axios';
import { config, logger } from '@inmate/shared';

export type HcsoDobResult = { dob?: string; name?: string; url: string; source: 'hcso'; rawHtmlSnippet?: string; notInJail?: boolean; asOf?: string; statusMessage?: string; noRecord?: boolean; bondExceptionText?: string; notBondable?: boolean; moreChargesPossible?: boolean };

// Extract DOB like 03/16/2000 or 3/6/2000; tolerate whitespace and table structures
export function parseDobFromHtml(html: string): { dob?: string; name?: string } {
  const cleaned = html.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
  // Try to capture NAME and DOB from table rows allowing nested tags in cells
  // Pattern: <td>...NAME...</td><td>...value...</td>
  const nameCell = cleaned.match(/<td[^>]*>\s*(?:<[^>]+>\s*)*name\s*(?:<[^>]+>\s*)*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  const name = nameCell ? stripHtml(nameCell[1]).trim() : undefined;

  // Pattern: <td>...DOB...</td><td>...01/24/2005...</td>
  const dobCell = cleaned.match(/<td[^>]*>\s*(?:<[^>]+>\s*)*dob\s*(?:<[^>]+>\s*)*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  let dob: string | undefined;
  if (dobCell) {
    const valText = stripHtml(dobCell[1]);
    const m = valText.match(/([0-1]?\d\/[0-3]?\d\/[12]\d{3})/);
    if (m) dob = m[1];
  }
  // Fallbacks: inline mentions
  if (!dob) {
    const fallback = cleaned.replace(/<[^>]*>/g, ' ');
    const m = fallback.match(/\b(?:dob|date\s*of\s*birth)\b\s*[:\-]?\s*([0-1]?\d\/[0-3]?\d\/[12]\d{3})/i);
    if (m) dob = m[1];
  }
  return { dob, name };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ');
}

// Detect "IS NOT IN JAIL" banner and an "INFORMATION ACCURATE AS OF ..." timestamp
export function parseStatusFromHtml(html: string): { notInJail?: boolean; asOf?: string; statusMessage?: string; noRecord?: boolean; bondExceptionText?: string; notBondable?: boolean; moreChargesPossible?: boolean } {
  const cleaned = html.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
  // Example: <p>CASTILLO, OSCAR(03308783) IS NOT IN JAIL</p>
  const notInJailMatch = cleaned.match(/>\s*([A-Z ,.'()-]+\(\d+\))\s+IS\s+NOT\s+IN\s+JAIL\s*<\/p>/i);
  const notInJail = !!notInJailMatch;
  // Example: INFORMATION ACCURATE AS OF 10/16/2025 - 15:00
  let asOf: string | undefined;
  const asOfMatch = cleaned.match(/INFORMATION\s+ACCURATE\s+AS\s+OF\s+([0-9]{1,2}\/[0-9]{1,2}\/[12][0-9]{3})\s*[-–]\s*([0-9]{1,2}:[0-9]{2})/i);
  if (asOfMatch) {
    const d = asOfMatch[1];
    const t = asOfMatch[2];
    asOf = `${d} ${t}`; // e.g., 10/16/2025 15:00
  }
  // Capture a status message text for reference
  let statusMessage: string | undefined;
  const msgTag = cleaned.match(/<p>\s*([^<]*IS\s+NOT\s+IN\s+JAIL[^<]*)<\/p>/i);
  if (msgTag) statusMessage = stripHtml(msgTag[1]).trim();
  // Detect "no record" messaging
  const noRec = /no\s+record\s+of\s+inmate|no\s+records?\s+found|no\s+matching\s+records?/i.test(cleaned);
  // Parse BOND EXC cell value
  let bondExceptionText: string | undefined;
  const bondExcCell = cleaned.match(/<td[^>]*>\s*(?:<[^>]+>\s*)*BOND\s*EXC\s*(?:<[^>]+>\s*)*<\/td>\s*<td[^>]*colspan="?3"?[^>]*>([\s\S]*?)<\/td>/i)
    || cleaned.match(/<td[^>]*>\s*(?:<[^>]+>\s*)*BOND\s*EXC\s*(?:<[^>]+>\s*)*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (bondExcCell) {
    bondExceptionText = stripHtml(bondExcCell[1]).trim().replace(/\u00a0/g, ' ');
  }
  const notBondable = !!(bondExceptionText && /bond\s*denied|no\s*bond|hold\s+no\s*bond/i.test(bondExceptionText));
  // Heuristic: if BOND AMT is blank AND there is a BOND EXC, it may indicate other charges not shown here
  const bondAmtBlank = /<td[^>]*>\s*(?:<[^>]+>\s*)*BOND\s*AMT\s*(?:<[^>]+>\s*)*<\/td>\s*<td[^>]*>\s*(?:&nbsp;|)\s*<\/td>/i.test(cleaned);
  const moreChargesPossible = !!(bondExceptionText && bondAmtBlank);
  return { notInJail, asOf, statusMessage, noRecord: noRec, bondExceptionText, notBondable, moreChargesPossible };
}

export async function lookupDobBySpn(spn: string): Promise<HcsoDobResult | null> {
  if (!(config as any).hcsoEnabled) {
    logger.info('HCSO scrape disabled via config');
    return null;
  }
  const base = ((config as any).hcsoBaseUrl as string).replace(/\/$/, '');
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
  try {
    // Try a few likely detail endpoints directly before attempting complex form workflows
    const candidateUrls = [
      `${base}/JailInfo/FindSomeoneInJail/Details/${encodeURIComponent(spn)}`,
      `${base}/JailInfo/FindSomeoneInJail/Details?SPN=${encodeURIComponent(spn)}`,
      `${base}/JailInfo/FindSomeoneInJail?SPN=${encodeURIComponent(spn)}`,
      `${base}/JailInfo/FindSomeoneInJail?Length=9&SPN=${encodeURIComponent(spn)}`,
    ];

    for (const url of candidateUrls) {
      try {
        const resp = await axios.get(url, {
          headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
          timeout: 15000,
          validateStatus: (s) => s >= 200 && s < 500,
        });
        const html = String(resp.data || '');
        if (!html || html.length < 200) {
          continue;
        }
        const { dob, name } = parseDobFromHtml(html);
        const status = parseStatusFromHtml(html);
        // Capture a small snippet around DOB for raw storage
        let snippet: string | undefined;
        if (dob) {
          const low = html.toLowerCase();
          const idx = low.indexOf('dob');
          snippet = idx >= 0 ? html.slice(Math.max(0, idx - 200), Math.min(html.length, idx + 200)) : undefined;
          return { dob, name, url, source: 'hcso', rawHtmlSnippet: snippet, ...status };
        }
        // If page includes obvious markers of inmate details, return snippet for debugging
        if (/inmate|details|spn/i.test(html)) {
          const idx = html.toLowerCase().indexOf('spn');
          snippet = idx >= 0 ? html.slice(Math.max(0, idx - 200), Math.min(html.length, idx + 200)) : html.slice(0, 400);
          return { url, source: 'hcso', rawHtmlSnippet: snippet, ...status };
        }
      } catch (e) {
        // try next
      }
    }

    // As a final fallback, attempt a minimal GET of the search page and naive POST with form data
    const searchUrl = `${base}/JailInfo/FindSomeoneInJail`;
    let html: string | undefined;
    try {
      const fallback = await axios.get(searchUrl, { headers: { 'User-Agent': ua }, timeout: 12000 });
      const tokenMatch = String(fallback.data || '').match(/name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/i);
      const token = tokenMatch?.[1];
      const cookie = (fallback.headers['set-cookie'] || []).map((c: string) => c.split(';')[0]).join('; ');
      const body = new URLSearchParams();
      if (token) body.set('__RequestVerificationToken', token);
      body.set('SPN', spn);
      body.set('GoogleCaptchaToken', '');
      const postResp = await axios.post(searchUrl, body.toString(), {
        headers: {
          'User-Agent': ua,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(token ? { Referer: searchUrl } : {}),
        },
        timeout: 12000,
        validateStatus: (s) => s >= 200 && s < 500,
      });
      html = String(postResp.data || '');
    } catch (e) {
      // ignore
    }
    if (!html) return null;
    const { dob, name } = parseDobFromHtml(html);
    const status = parseStatusFromHtml(html);
    let snippet: string | undefined;
    if (dob) {
      const low = html.toLowerCase();
      const idx = low.indexOf('dob');
      snippet = idx >= 0 ? html.slice(Math.max(0, idx - 200), Math.min(html.length, idx + 200)) : undefined;
      return { dob, name, url: searchUrl, source: 'hcso', rawHtmlSnippet: snippet, ...status };
    }
    return { url: searchUrl, source: 'hcso', rawHtmlSnippet: html.slice(0, 400), ...status };
  } catch (e) {
    logger.warn(`HCSO lookup failed for SPN ${spn}: ${e}`);
    return null;
  }
}
