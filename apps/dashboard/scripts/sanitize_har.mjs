#!/usr/bin/env node
// scripts/sanitize_har.mjs
// Sanitize a HAR by removing sensitive headers, cookies, query strings, and response bodies,
// while preserving URLs (origin+path), methods, statuses, timings, and sizes for analysis.
//
// Usage:
//   node scripts/sanitize_har.mjs input.har output.har [--keep-query-keys=key1,key2]
//
// Notes:
// - By default, all query strings are stripped. You can keep specific keys using --keep-query-keys.
// - Request/response cookies are removed. Authorization-like headers are removed.
// - Response bodies (content.text) are removed; sizes are preserved when available.

import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'x-access-token',
  'x-amz-security-token', 'x-csrf-token', 'x-xsrf-token', 'dnt', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
]);

function parseArgs(argv) {
  const args = { input: argv[2], output: argv[3], keepQueryKeys: [] };
  for (const a of argv.slice(4)) {
    if (a.startsWith('--keep-query-keys=')) {
      args.keepQueryKeys = a.split('=')[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
  }
  if (!args.input || !args.output) {
    console.error('Usage: node scripts/sanitize_har.mjs input.har output.har [--keep-query-keys=key1,key2]');
    process.exit(1);
  }
  return args;
}

function keepHeader(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  if (SENSITIVE_HEADER_NAMES.has(n)) return false;
  // Common, generally safe headers to keep; everything else is dropped.
  return ['accept', 'accept-language', 'content-type', 'cache-control', 'pragma'].includes(n);
}

function sanitizeUrl(u, keepKeys) {
  try {
    const url = new URL(u);
    if (!keepKeys || keepKeys.length === 0) {
      return url.origin + url.pathname; // strip full query by default
    }
    const qp = new URLSearchParams(url.search);
    const kept = new URLSearchParams();
    for (const k of keepKeys) {
      if (qp.has(k)) kept.set(k, '[redacted]');
    }
    const qs = kept.toString();
    return url.origin + url.pathname + (qs ? '?' + qs : '');
  } catch {
    return u; // leave as-is if parsing fails
  }
}

function redactHeaders(headers = []) {
  if (!Array.isArray(headers)) return [];
  const out = [];
  for (const h of headers) {
    const name = h?.name ?? '';
    if (!keepHeader(name)) continue;
    out.push({ name, value: '[redacted]' });
  }
  return out;
}

function sanitizeEntry(entry, keepQueryKeys) {
  const e = JSON.parse(JSON.stringify(entry)); // deep clone

  // Request
  if (e.request) {
    e.request.url = sanitizeUrl(e.request.url || '', keepQueryKeys);
    e.request.headers = redactHeaders(e.request.headers);
    e.request.cookies = [];
    if (e.request.postData) {
      // Keep only mimeType, drop text/params
      const ct = e.request.postData.mimeType;
      e.request.postData = ct ? { mimeType: ct, text: '[redacted]' } : undefined;
    }
    // Remove queryString array (keys/values), preserve nothing
    e.request.queryString = [];
  }

  // Response
  if (e.response) {
    const status = e.response.status;
    const statusText = e.response.statusText;
    const mimeType = e.response.content?.mimeType;
    const size = Number(e.response.content?.size ?? 0);
    e.response.headers = redactHeaders(e.response.headers);
    e.response.cookies = [];
    e.response.redirectURL = '';
    e.response.content = { mimeType: mimeType || '', size, text: undefined };
  }

  // Drop IPs and connection details
  e.serverIPAddress = undefined;
  e.connection = undefined;

  // Cache object can be left as-is or emptied
  e.cache = {};

  return e;
}

function main() {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);

  const raw = fs.readFileSync(inputPath, 'utf8');
  let har;
  try { har = JSON.parse(raw); } catch (e) {
    console.error('Failed to parse HAR JSON:', e.message);
    process.exit(1);
  }

  const log = har.log || {};
  const entries = Array.isArray(log.entries) ? log.entries : [];
  const sanitizedEntries = entries.map((e) => sanitizeEntry(e, args.keepQueryKeys));

  const out = {
    log: {
      version: log.version || '1.2',
      creator: log.creator || { name: 'sanitizer', version: '1.0.0' },
      pages: log.pages || [],
      entries: sanitizedEntries,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Sanitized HAR written to: ${outputPath}`);
  console.log(`Entries: ${sanitizedEntries.length}`);
}

main();
