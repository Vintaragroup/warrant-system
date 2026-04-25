#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const filePath = process.argv[2] || path.resolve('server/.secrets/firebase.json');

const out = (obj) => {
  console.log(JSON.stringify(obj, null, 2));
};

try {
  if (!fs.existsSync(filePath)) {
    out({ exists: false, message: `File not found: ${filePath}` });
    process.exit(0);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    out({ exists: true, parsed: false, error: `JSON parse error: ${e.message}` });
    process.exit(0);
  }

  const required = [
    'type',
    'project_id',
    'private_key_id',
    'private_key',
    'client_email',
    'client_id',
    'auth_uri',
    'token_uri',
    'auth_provider_x509_cert_url',
    'client_x509_cert_url',
  ];
  const missing = required.filter((k) => !json[k]);
  const pk = json.private_key || '';
  const markers = /BEGIN PRIVATE KEY/.test(pk) && /END PRIVATE KEY/.test(pk);
  const pkLen = pk.length;

  out({
    exists: true,
    parsed: true,
    requiredMissing: missing,
    project_id_present: !!json.project_id,
    client_email_present: !!json.client_email,
    privateKeyMarkers: markers,
    privateKeyLength: pkLen,
    tip: 'If requiredMissing is empty and privateKeyMarkers is true, the file looks good.'
  });
} catch (e) {
  out({ error: e.message });
  process.exit(1);
}
