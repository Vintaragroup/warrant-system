#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || process.env.MONGO_DB_NAME });
  const db = mongoose.connection.db;
  
  // Find the inmate with that address
  const inmates = db.collection('simple_harris');
  const rec = await inmates.findOne({ 'crm_details.address.streetLine1': /9602.*BRENT/ });
  
  if (rec) {
    console.log('Found inmate:');
    console.log('  SPN:', rec.spn);
    console.log('  Full Name:', rec.full_name);
    console.log('  CRM Address:', JSON.stringify(rec.crm_details?.address, null, 2));
  } else {
    // Try by city
    const byCit = await inmates.findOne({ 'crm_details.address.city': 'TOMBALL' });
    if (byCit) {
      console.log('Found by TOMBALL:');
      console.log('  SPN:', byCit.spn);
      console.log('  Full Name:', byCit.full_name);
      console.log('  CRM Address:', JSON.stringify(byCit.crm_details?.address, null, 2));
    } else {
      console.log('Not found');
    }
  }
  
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
