#!/usr/bin/env node
/* eslint-env node */
/**
 * Seed test data into MongoDB for local development
 * Run: node scripts/seed-test-data.js
 */

import process from 'node:process';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27018';
const MONGO_DB = process.env.MONGO_DB || 'warrantdb';

const mongoUri = `${MONGO_URI}/${MONGO_DB}`;

const seedData = async () => {
  try {
    console.log(`Connecting to ${mongoUri}...`);
    await mongoose.connect(mongoUri);
    
    const db = mongoose.connection.db;
    const col = db.collection('simple_harris');
    
    // Generate 10 test cases
    const now = new Date();
    const testCases = [];
    
    for (let i = 1; i <= 10; i++) {
      const bookingTime = new Date(now.getTime() - (i * 60 * 60 * 1000)); // staggered by hour
      testCases.push({
        case_number: `0317264${i}`.slice(-8),
        county: 'harris',
        category: i % 2 === 0 ? 'Criminal' : 'Civil',
        full_name: `Test Defendant ${i}`,
        spn: `SPN${i}`,
        dob: new Date(1990, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
        gender: i % 2 === 0 ? 'M' : 'F',
        race: 'White',
        booking_datetime: bookingTime.toISOString(),
        booking_date_v2: bookingTime.toISOString().split('T')[0],
        booking_derivation_source: 'first_seen_at',
        bond_amount: 5000 * i,
        bond_label: `Bond ${i}`,
        charge: `Test Charge ${i}`,
        agency: 'Harris County',
        facility: 'Main Jail',
        time_bucket_v2: bookingTime > new Date(now.getTime() - 24 * 60 * 60 * 1000) ? '0_24h' : '24_48h',
        needs_attention: i === 1 || i === 3,
        crm_details: {
          stage: 'new',
          assignedTo: '',
          department: '',
          address: {
            streetLine1: `${100 + i} Main St`,
            city: 'Houston',
            stateCode: 'TX',
            postalCode: '77001'
          },
          phone: `713555${String(i).padStart(4, '0')}`
        },
        scraped_at: bookingTime,
        normalized_at: new Date()
      });
    }
    
    console.log(`Inserting ${testCases.length} test cases...`);
    const result = await col.insertMany(testCases);
    console.log(`✅ Inserted ${result.insertedCount} documents`);
    
    // Verify
    const count = await col.countDocuments();
    console.log(`📊 Total documents in simple_harris: ${count}`);
    
    await mongoose.disconnect();
    console.log('✨ Done!');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
};

seedData();
