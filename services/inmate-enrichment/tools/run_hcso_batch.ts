import 'dotenv/config';
import axios from 'axios';
import mongoose from 'mongoose';
import { InmateModel, config, getIngestionTimestamp, isWithinWindow } from '@inmate/shared';

async function main() {
  await mongoose.connect(config.mongoUri, { dbName: config.mongoDbName });
  const { bondThreshold, enrichmentWindowHours } = config;
  // Find candidates missing dob within window and bond >= threshold, cap 20 ids
  const docs = await InmateModel.find({ $or: [{ dob: { $exists: false } }, { dob: null }, { dob: '' }] }).limit(200).lean();
  const eligible: string[] = [];
  for (const d of docs) {
    const ts = getIngestionTimestamp(d as any);
    const bond = (d as any)?.bond_amount ?? (d as any)?.bond ?? 0;
    const spn = (d as any)?.spn || (d as any)?.subject_id || (d as any)?.subjectId;
    if (!spn) continue;
    if (bond < bondThreshold) continue;
    if (!ts || !isWithinWindow(ts, enrichmentWindowHours)) continue;
    eligible.push(String(spn));
    if (eligible.length >= 20) break;
  }
  if (eligible.length === 0) {
    console.log('No eligible candidates found.');
    return;
  }
  console.log('Enqueuing', eligible.length, 'SPNs', eligible);
  const base = `http://localhost:${config.port}/api`;
  const resp = await axios.post(`${base}/enrichment/run`, { subjectIds: eligible, mode: 'standard' });
  console.log('JobIds:', resp.data?.jobIds);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
