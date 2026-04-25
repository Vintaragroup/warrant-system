#!/usr/bin/env node

/**
 * Seed test data into county collections for local development
 * Run with: node scripts/seed-county-data.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27018';
const MONGO_DB = process.env.MONGO_DB || 'warrantdb';
const FULL_URI = `${MONGO_URI}/${MONGO_DB}`;

const COUNTY_COLLECTIONS = [
  'simple_harris',
  'simple_jefferson',
  'simple_brazoria',
  'simple_galveston',
  'simple_fortbend',
];

// Sample test data for each county
const generateSampleCases = (county, count = 50) => {
  const cases = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30); // 30 days ago
  
  const charges = [
    'ASSAULT - BODILY INJURY',
    'BURGLARY OF HABITATION',
    'THEFT > $100 < $750',
    'DWI - 1ST OFFENSE',
    'POSSESSION OF CONTROLLED SUBSTANCE',
    'CRIMINAL MISCHIEF > $750 < $2500',
    'AGGRAVATED ASSAULT WITH WEAPON',
    'STALKING',
    'FRAUD - THEFT BY CHECK',
  ];
  
  const facilities = {
    simple_harris: 'HCSO MAIN JAIL',
    simple_jefferson: 'JEFFERSON COUNTY JAIL',
    simple_brazoria: 'BRAZORIA COUNTY JAIL',
    simple_galveston: 'GALVESTON COUNTY JAIL',
    simple_fortbend: 'FORT BEND COUNTY JAIL',
  };
  
  const agencies = {
    simple_harris: 'HARRIS COUNTY JAIL SYSTEM',
    simple_jefferson: 'JEFFERSON COUNTY SHERIFF',
    simple_brazoria: 'BRAZORIA COUNTY SHERIFF',
    simple_galveston: 'GALVESTON COUNTY SHERIFF',
    simple_fortbend: 'FORT BEND COUNTY SHERIFF',
  };
  
  const names = [
    'JOHN SMITH', 'MARIA GARCIA', 'JAMES JOHNSON', 'SARAH WILLIAMS',
    'MICHAEL BROWN', 'JENNIFER JONES', 'ROBERT DAVIS', 'LISA MILLER',
    'DAVID WILSON', 'EMMA MOORE', 'DANIEL TAYLOR', 'SOPHIA ANDERSON',
    'MATTHEW THOMAS', 'OLIVIA JACKSON', 'CHRISTOPHER WHITE', 'AVA HARRIS',
    'ANTHONY MARTIN', 'ISABELLA THOMPSON', 'MARK GARCIA', 'MIA MARTINEZ',
  ];

  for (let i = 0; i < count; i++) {
    const bookingDate = new Date(startDate);
    bookingDate.setHours(Math.floor(Math.random() * 24));
    bookingDate.setMinutes(Math.floor(Math.random() * 60));
    
    const nameIdx = Math.floor(Math.random() * names.length);
    const nameParts = names[nameIdx].split(' ');
    
    const bondAmount = [1000, 2500, 5000, 10000, 15000, 25000, 50000][
      Math.floor(Math.random() * 7)
    ];
    
    cases.push({
      full_name: names[nameIdx],
      first_name: nameParts[0],
      last_name: nameParts[1],
      dob: new Date(1980 + Math.floor(Math.random() * 40), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1)
        .toISOString()
        .split('T')[0],
      sex: Math.random() > 0.5 ? 'M' : 'F',
      race: ['WHITE', 'BLACK', 'HISPANIC', 'ASIAN', 'OTHER'][Math.floor(Math.random() * 5)],
      height_ft: 5 + Math.floor(Math.random() * 2),
      height_in: Math.floor(Math.random() * 12),
      weight_lb: 120 + Math.floor(Math.random() * 150),
      
      county: county.replace('simple_', '').toUpperCase(),
      agency: agencies[county],
      facility: facilities[county],
      
      booking_date: bookingDate.toISOString().split('T')[0],
      booking_number: `${county.replace('simple_', '').toUpperCase()}-${1000000 + i}`,
      case_number: `${Math.floor(Math.random() * 10000000)}`,
      spn: `${String(i).padStart(9, '0')}`,
      
      charge: charges[Math.floor(Math.random() * charges.length)],
      charge_grade: Math.random() > 0.5 ? 'FELONY' : 'MISDEMEANOR',
      offense: charges[Math.floor(Math.random() * charges.length)],
      status: 'ACTIVE',
      
      bond_amount: bondAmount,
      bond_label: 'SECURED BOND',
      bond_type: 'CASH BOND',
      
      phone_nbr1: `713${String(Math.floor(Math.random() * 9999999)).padStart(7, '0')}`,
      phone_nbr2: Math.random() > 0.5 ? `832${String(Math.floor(Math.random() * 9999999)).padStart(7, '0')}` : null,
      phone_nbr3: null,
      
      address_line_1: `${1000 + i} MAIN STREET`,
      address_line_2: '',
      city: 'HOUSTON',
      state: 'TX',
      postal_code: '7700' + String(Math.floor(Math.random() * 100)).padStart(2, '0'),
      
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  
  return cases;
};

async function seed() {
  try {
    // Connect to MongoDB
    console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✓ Connected to MongoDB');
    
    const db = mongoose.connection.db;
    
    // Seed each county collection
    for (const county of COUNTY_COLLECTIONS) {
      const collection = db.collection(county);
      
      // Check if collection already has data
      const existingCount = await collection.countDocuments();
      if (existingCount > 0) {
        console.log(`⊘ ${county}: Already has ${existingCount} documents, skipping`);
        continue;
      }
      
      // Generate and insert test data
      const testData = generateSampleCases(county, 50);
      const result = await collection.insertMany(testData);
      console.log(`✓ ${county}: Inserted ${result.insertedIds.length} test documents`);
    }
    
    console.log('\n✓ Seeding complete!');
    console.log('\nYou can now test the API endpoints:');
    console.log('  GET http://localhost:8080/api/cases');
    console.log('  GET http://localhost:8080/api/cases/by-case-number/0000000001');
    console.log('  GET http://localhost:8080/api/dashboard/kpis');
    
  } catch (err) {
    console.error('✗ Seeding failed:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

// Run seeding
seed();
