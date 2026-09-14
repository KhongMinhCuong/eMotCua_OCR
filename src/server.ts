import 'express-async-errors';
import express, { Request, Response } from 'express';
import { ocrRouter } from './routes/ocr';
import { extractRouter } from './routes/extract';

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_request: Request, response: Response) => {
    response.json({ success: true, data: { status: 'ok' } });
  });
  app.use('/api/ocr', ocrRouter);
  app.use('/api/extract', extractRouter);

  return app;
}