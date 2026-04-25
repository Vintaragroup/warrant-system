import mongoose from 'mongoose';

export async function connectMongo(uri, dbName) {
  // Keep queries strict and predictable
  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    dbName,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000, // fail fast if Atlas is unreachable
    heartbeatFrequencyMS: 10000,    // detect connectivity issues quicker
  });

  const conn = mongoose.connection;

  // Connection lifecycle logging
  conn.on('connected',    () => console.log('🟢 Mongo connected'));
  conn.on('error',        (e) => console.error('🔴 Mongo error:', e));
  conn.on('disconnected', () => console.warn('🟠 Mongo disconnected'));
  // Note: mongoose uses topology events; 'reconnected' fires on driver-managed reconnects
  conn.on('reconnected',  () => console.log('🟢 Mongo reconnected'));

  // Graceful shutdown
  process.on('SIGINT', async () => {
    try {
      await conn.close();
      console.log('🔴 Mongo disconnected on app termination');
    } finally {
      process.exit(0);
    }
  });
}

// Optional: expose the current connection for places that need raw db access
export function getMongo() {
  return mongoose.connection;
}