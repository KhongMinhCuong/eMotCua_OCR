import { Router } from 'express';
import { execSync } from 'child_process';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { config } from '../config';
import { fixLayout } from '../services/layout.service';
import { ocrDocument } from '../services/ocr.service';
import { extractFields, getGpuStats, getSystemRam } from '../services/ai.service';
import { cleanupFile, isValidExtension } from '../utils/file';
import { errorResponse, successResponse } from '../utils/response';

const upload = multer({
  dest: config.UPLOAD_DIR,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter: (_request, file, callback) => {
    callback(null, isValidExtension(file.originalname));
  },
});

export const extractRouter = Router();

extractRouter.post('/', upload.array('files', 5), async (request, response) => {
  const files = request.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return errorResponse(response, 400, 'Cần gửi ít nhất một file PDF hoặc ảnh trong field "files".');
  }

  const docType = request.body.docType === 'cccd' ? 'cccd' : 'gcn'; // người dùng chọn trước, không tự đoán
  const debug = process.env.DEBUG === '1' || request.query.debug === '1';
  const totalStart = Date.now();
  const memStart = process.memoryUsage();

  const filesOut: any[] = [];
  const ocrDebugs: any[] = [];
  const fixedTexts: string[] = [];
  let mrz = null as import('../services/ocr.service').MrzResult | null;

  try {
    for (const file of files) {
      const extension = path.extname(file.originalname).toLowerCase();
      const filePath = `${file.path}${extension}`;
      await fs.rename(file.path, filePath);

      let ocrResult;
      try {
        ocrResult = await ocrDocument(filePath, debug);
      } finally {
        cleanupFile(filePath);
      }
      ocrDebugs.push(ocrResult.debug ?? null);
      mrz = mrz ?? ocrResult.mrz ?? null; // usually only the back-of-card image has one

      const fixedText = fixLayout(ocrResult.rawText);
      fixedTexts.push(fixedText);

      filesOut.push({
        fileName: file.originalname,
        rawText: ocrResult.rawText,
        fixedText,
        pageCount: ocrResult.pageCount,
      });
    }

    // Nhiều ảnh của cùng 1 giấy tờ: gộp text theo thứ tự upload, đánh dấu ranh
    // giới ảnh để model tự đối chiếu/hợp nhất field rải rác qua các ảnh.
    const mergedText = fixedTexts.length === 1
      ? fixedTexts[0]
      : fixedTexts.map((t, i) => `--- Ảnh ${i + 1} ---\n${t}`).join('\n\n');

    const aiResult = await extractFields(mergedText, docType, debug, docType === 'cccd' ? mrz : null);
    const fields = 'fields' in aiResult ? aiResult.fields : aiResult;
    const aiDebug = 'debug' in aiResult ? aiResult.debug : undefined;

    const memEnd = process.memoryUsage();
    const totalS = Math.round((Date.now() - totalStart) / 1000 * 1000) / 1000;

    const result: any = {
      files: filesOut,
      processingTimeMs: Date.now() - totalStart,
      fields,
    };

    if (debug) {
      result.debug = {
        ocr: ocrDebugs,
        ai: aiDebug ?? null,
        memory: {
          rssStartMB: Math.round(memStart.rss / 1024 / 1024),
          rssPeakMB: Math.round(memEnd.rss / 1024 / 1024),
          rssEndMB: Math.round(memEnd.rss / 1024 / 1024),
        },
        gpu: getGpuStats(),
        systemRam: getSystemRam(),
        total_s: totalS,
      };
    }

    return successResponse(response, result);
  } catch (error) {
    files.forEach((f) => cleanupFile(f.path));
    return errorResponse(response, 500, error instanceof Error ? error.message : 'Trích xuất thất bại.');
  }
});
