import { CccdFields, ExtractDebug, ExtractedFields } from '../services/ai.service';

// Types for OCR processing
export interface OcrResult {
  fileName: string;
  rawText: string;
  fixedText: string;
  pageCount: number;
  processingTimeMs: number;
}

export interface OcrResponse {
  success: boolean;
  data?: OcrResult;
  error?: string;
}

export interface ExtractDebugInfo {
  ocr: {
    loadPages_s: number;
    pages: Array<{ boxes: number; rows: number; detect_s: number; recognize_s: number }>;
    total_ocr_s: number;
    memStartMB: number;
    memEndMB: number;
  };
  layout_s: number;
  ai: ExtractDebug;
  memory: {
    rssStartMB: number;
    rssPeakMB: number;
    rssEndMB: number;
  };
  vram: {
    llamaUsedMB: number | null;
  };
  total_s: number;
}

export interface ExtractResult extends OcrResult {
  fields: ExtractedFields | CccdFields;
  debug?: ExtractDebugInfo;
}

export interface ExtractResponse {
  success: boolean;
  data?: ExtractResult;
  error?: string;
}