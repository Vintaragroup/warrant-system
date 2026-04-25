import IORedis from 'ioredis';

let sharedConnection = null;

export function getRedisConfig() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379/0';
  return {
    url,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(5000, times * 200);
      return delay;
    },
  };
}

export function getRedisConnection() {
  if (!sharedConnection) {
    const config = getRedisConfig();
    sharedConnection = new IORedis(config.url, config);
    sharedConnection.on('error', (err) => {
      console.error('Redis connection error', err?.message || err);
    });
    sharedConnection.on('connect', () => {
      console.log('✅ Redis connected');
    });
  }
  return sharedConnection;
}

export function createNewRedisConnection() {
  const config = getRedisConfig();
  const conn = new IORedis(config.url, config);
  conn.on('error', (err) => {
    console.error('Redis connection error', err?.message || err);
  });
  return conn;
}
