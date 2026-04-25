import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';

// Resolve repo paths relative to this script (server/scripts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultSpec = path.resolve(__dirname, '../src/openapi.yaml');

// CLI:
//   node scripts/validate-openapi.js [specPath] [--out openapi.bundle.json]
const args = process.argv.slice(2);
const specArg = args.find(a => !a.startsWith('-'));
const outIdx = args.findIndex(a => a === '--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

const specPath = specArg ? path.resolve(process.cwd(), specArg) : defaultSpec;

function humanBytes(n) {
  if (!Number.isFinite(n)) return `${n}`;
  const units = ['B','KB','MB','GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

if (!fs.existsSync(specPath)) {
  console.error(`❌ Spec not found at: ${specPath}`);
  process.exit(2);
}

(async () => {
  try {
    const api = await SwaggerParser.validate(specPath);
    const version = api?.info?.version || 'unknown';
    console.log(`✅ OpenAPI is valid. (${api.openapi || api.swagger}) version=${version}`);

    // Optional: bundle to a single JSON (useful for Postman import, CI artifacts)
    if (outFile) {
      const bundled = await SwaggerParser.bundle(specPath);
      const outAbs = path.resolve(process.cwd(), outFile);
      fs.writeFileSync(outAbs, JSON.stringify(bundled, null, 2), 'utf8');
      const stats = fs.statSync(outAbs);
      console.log(`📦 Bundled spec written → ${outAbs} (${humanBytes(stats.size)})`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ OpenAPI validation failed:');
    console.error(`   ${err.message || err}`);

    // apidevtools often provides detailed errors (one per location)
    if (Array.isArray(err?.details) && err.details.length) {
      for (const d of err.details) {
        const where = [d.path, d.location?.start?.line && `line ${d.location.start.line}`].filter(Boolean).join(' • ');
        console.error(`   - ${d.message}${where ? ` (${where})` : ''}`);
      }
    }
    process.exit(1);
  }
})();