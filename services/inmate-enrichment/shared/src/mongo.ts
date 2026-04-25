import mongoose from 'mongoose';
import { config } from './config';
import { logger } from './logger';

let isConnected = false;

export async function connectMongo(): Promise<typeof mongoose> {
  if (isConnected) return mongoose;
  const uri = config.mongoUri;
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    dbName: config.mongoDbName,
  } as any);
  isConnected = true;
  logger.info('Mongo connected', { db: config.mongoDbName });
  return mongoose;
}
