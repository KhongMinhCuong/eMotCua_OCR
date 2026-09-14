import { config } from '../config';

export const uploadDir = config.UPLOAD_DIR;

// Ensure upload directory exists
import fs from 'fs';
import path from 'path';

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Validate file extension
export const isValidExtension = (filename: string): boolean => {
  const ext = path.extname(filename).toLowerCase();
  return config.ALLOWED_EXTENSIONS.includes(ext);
};

// Validate file size
export const isValidSize = (size: number): boolean => {
  return size <= config.MAX_FILE_SIZE;
};

// Clean up temporary file
export const cleanupFile = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Failed to clean up ${filePath}`, err);
  }
};

// MIME type to extension mapping
export const mimeToExt = (mime: string): string => {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
  };
  return map[mime] || '';
};