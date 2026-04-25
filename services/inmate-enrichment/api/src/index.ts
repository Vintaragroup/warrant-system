import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config, connectMongo, logger } from '@inmate/shared';
import { createServer } from './server';
import { openapiSpec } from './openapi';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import fs from 'fs';

async function main() {
  await connectMongo();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  const router = await createServer();
  app.use('/api', router);

  // OpenAPI JSON and Swagger UI
  app.get('/api/openapi.json', (_req: Request, res: Response) => {
    res.json(openapiSpec);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  // optional: static serve web build if present
  const webDir = path.join(__dirname, '../../web/dist');
  if (fs.existsSync(webDir)) {
    app.use(express.static(webDir));
  }

  app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

  app.listen(config.port, () => {
    logger.info(`API listening on :${config.port}`);
  });
}

main().catch((err) => {
  logger.error('Fatal error', { err: String(err), stack: (err as any)?.stack });
  process.exit(1);
});
