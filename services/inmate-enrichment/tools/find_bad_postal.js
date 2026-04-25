#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || process.env.MONGO_DB_NAME });
  const db = mongoose.connection.db;
  
  for (const colName of ['simple_harris', 'simple_jefferson', 'simple_brazoria', 'simple_galveston', 'simple_fortbend']) {
    const col = db.collection(colName);
    const first = await col.findOne({ 'crm_details.address.postalCode': /;/ });
    if (first) {
      console.log(`Found in ${colName}: ${first.spn}`);
      break;
    }
  }
  await mongoose.disconnect();
})();
