import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { config } from '../config';
import { fixLayout } from '../services/layout.service';
import { ocrDocument } from '../services/ocr.service';
import { cleanupFile, isValidExtension } from '../utils/file';
import { errorResponse, successResponse } from '../utils/response';

const upload = multer({
  dest: config.UPLOAD_DIR,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter: (_request, file, callback) => {
    callback(null, isValidExtension(file.originalname));
  },
});

export const ocrRouter = Router();

ocrRouter.post('/', upload.single('file'), async (request, response) => {
  if (!request.file) {
    return errorResponse(response, 400, 'Cần gửi một file PDF hoặc ảnh trong field "file".');
  }

  const startedAt = Date.now();
  const temporaryPath = request.file.path;

  try {
    const extension = path.extname(request.file.originalname).toLowerCase();
    const filePath = `${temporaryPath}${extension}`;
    await import('fs/promises').then((fs) => fs.rename(temporaryPath, filePath));

    const { rawText, pageCount } = await ocrDocument(filePath);
    cleanupFile(filePath);

    return successResponse(response, {
      fileName: request.file.originalname,
      rawText,
      fixedText: fixLayout(rawText),
      pageCount,
      processingTimeMs: Date.now() - startedAt,
    });
  } catch (error) {
    cleanupFile(temporaryPath);
    return errorResponse(response, 500, error instanceof Error ? error.message : 'OCR thất bại.');
  }
});
