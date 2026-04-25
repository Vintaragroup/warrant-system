/* eslint-env node */
// server/src/indexes.js
// Ensure critical indexes exist on raw simple_* collections used by dashboard unions.
// This runs on startup and is idempotent.

export async function ensureDashboardIndexes(mongooseConn) {
  try {
    const db = mongooseConn && mongooseConn.db ? mongooseConn.db : null;
    if (!db) return;

    const collections = [
      'simple_brazoria',
      'simple_fortbend',
      'simple_galveston',
      'simple_harris',
      'simple_jefferson',
    ];

    const indexDefs = [
      // Booking date strings (YYYY-MM-DD) and booking timestamps for range scans (legacy fields retained for fallback)
      { keys: { booking_date: 1 }, options: { name: 'booking_date_1', background: true } },
      { keys: { booked_at: 1 }, options: { name: 'booked_at_1', background: true } },
      { keys: { booking_date_iso: 1 }, options: { name: 'booking_date_iso_1', background: true } },
      // Canonical contract time fields (v2)
      { keys: { time_bucket_v2: 1 }, options: { name: 'time_bucket_v2_1', background: true } },
      { keys: { booking_datetime: 1 }, options: { name: 'booking_datetime_1', background: true } },
      // County & category
      { keys: { county: 1 }, options: { name: 'county_1', background: true } },
      { keys: { category: 1 }, options: { name: 'category_1', background: true } },
      // Common compounds - support bucket + county filters and top sorting by bond
      { keys: { county: 1, time_bucket_v2: 1 }, options: { name: 'county_1_time_bucket_v2_1', background: true } },
      { keys: { time_bucket_v2: 1, county: 1 }, options: { name: 'time_bucket_v2_1_county_1', background: true } },
      { keys: { county: 1, time_bucket_v2: 1, bond_amount: -1 }, options: { name: 'county_1_time_bucket_v2_1_bond_amount_-1', background: true } },
      // Legacy compound for comparison
      { keys: { county: 1, booking_date: 1 }, options: { name: 'county_1_booking_date_1', background: true } },
    ];

    for (const collName of collections) {
      try {
        const coll = db.collection(collName);
        for (const { keys, options } of indexDefs) {
          try {
            await coll.createIndex(keys, options);
          } catch (err) {
            // ignore individual index failures to avoid blocking startup
            // console.warn(`Index create failed on ${collName} ${options?.name}:`, err.message);
            void err;
          }
        }
      } catch (err) {
        // console.warn(`Skipping index ensure on ${collName}:`, err.message);
        void err;
      }
    }
  } catch {
    // best-effort
  }
}
