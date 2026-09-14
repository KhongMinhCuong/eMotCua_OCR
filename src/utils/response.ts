import { Response } from 'express';
import { OcrResult, ExtractResult } from '../types';

export const successResponse = (res: Response, data: OcrResult | ExtractResult): Response => {
  return res.json({ success: true, data });
};

export const errorResponse = (res: Response, statusCode: number, error: string): Response => {
  return res.status(statusCode).json({ success: false, error });
};