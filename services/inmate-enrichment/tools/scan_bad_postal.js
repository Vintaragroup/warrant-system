#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || process.env.MONGO_DB_NAME });
  const db = mongoose.connection.db;
  
  const collections = [
    'simple_harris',
    'simple_jefferson',
    'simple_brazoria',
    'simple_galveston',
    'simple_fortbend',
    'harris_bond',
    'fortbend_inmates',
    'brazoria_inmates',
  ];

  console.log('Scanning for bad postal codes by collection:');
  console.log('');

  let totalBad = 0;
  for (const colName of collections) {
    const col = db.collection(colName);
    
    // Count all with CRM address
    const withCrm = await col.countDocuments({ 'crm_details.address': { $exists: true } });
    
    // Count with bad postal (;, empty, null)
    const badCount = await col.countDocuments({
      'crm_details.address': { $exists: true },
      $or: [
        { 'crm_details.address.postalCode': ';' },
        { 'crm_details.address.postalCode': '' },
        { 'crm_details.address.postalCode': null },
        { 'crm_details.address.postalCode': { $exists: false } },
      ],
    });

    totalBad += badCount;
    console.log(`${colName.padEnd(25)} | CRM: ${String(withCrm).padStart(6)} | Bad ZIP: ${String(badCount).padStart(6)}`);
  }

  console.log('');
  console.log(`Total bad postal codes: ${totalBad}`);
  await mongoose.disconnect();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
