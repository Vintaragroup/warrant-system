// Usage: mongosh "$MONGO_URI/$MONGO_DB" inspect_simple_collections.mjs
// Summarizes fields and sample docs in simple_* collections used by Telnyx tools

const SIMPLE = ["harris", "brazoria", "galveston", "fortbend"];

function isObjectId(val) {
  return val && typeof val === 'object' && val._bsontype === 'ObjectId';
}

function typeOfVal(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (isObjectId(v)) return 'ObjectId';
  return typeof v;
}

function summarizeCollection(db, name) {
  const col = db.collection(name);
  const total = col.estimatedDocumentCount();
  if (total === 0) {
    return { name, total, fields: {}, samples: [] };
  }

  // Sample a handful of recent docs if booking_date exists; else random
  let cursor;
  if (col.indexes().some(ix => ix.key && ix.key.booking_date)) {
    cursor = col.find({}).sort({ booking_date: -1 }).limit(10);
  } else {
    cursor = col.aggregate([{ $sample: { size: 10 } }]);
  }

  const fields = {};
  const samples = [];

  cursor.forEach(doc => {
    samples.push(doc);
    Object.keys(doc).forEach(k => {
      const t = typeOfVal(doc[k]);
      fields[k] = fields[k] || new Set();
      fields[k].add(t);
    });
  });

  // Convert sets to arrays and sort
  const fieldSummary = Object.fromEntries(
    Object.entries(fields).map(([k, set]) => [k, Array.from(set).sort()])
  );

  return { name, total, fields: fieldSummary, sampleCount: samples.length, samples };
}

function main() {
  const dbName = db.getName();
  print(`Inspecting simple_* collections in database: ${dbName}`);

  const names = db.getCollectionNames().filter(n => SIMPLE.map(c => `simple_${c}`).includes(n));
  if (names.length === 0) {
    print("No simple_* collections found.");
    return;
  }

  names.forEach(n => {
    const summary = summarizeCollection(db, n);
    print("\n==== "+n+" ====");
    printjson({ total: summary.total, fields: summary.fields, sampleCount: summary.sampleCount });
    // Print a few truncated samples (omit large arrays/strings)
    const showKeys = ["_id","full_name","first_name","last_name","dob","county","booking_date","bond","bond_amount","booking_number","normalized_at","category"]; 
    summary.samples.slice(0,3).forEach((s, i) => {
      const view = {};
      showKeys.forEach(k => { if (k in s) view[k] = s[k]; });
      print("-- sample "+(i+1)+" --");
      printjson(view);
    });
  });
}

main();
