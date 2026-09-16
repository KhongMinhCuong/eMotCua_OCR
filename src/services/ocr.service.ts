import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import readline from 'readline';
import os from 'os';
import path from 'path';

export interface MrzResult {
  raw: string;
  soCCCD: string;
  ngaySinh: string;
  gioiTinh: string;
  ngayHetHan: string;
  hoTen: string;
}

interface PythonOcrResult {
  rawText: string;
  pageCount: number;
  mrz?: MrzResult | null;
  debug?: {
    loadPages_s: number;
    pages: Array<{ boxes: number; rows: number; detect_s: number; recognize_s: number }>;
    total_ocr_s: number;
    memStartMB: number;
    memEndMB: number;
  };
}

// Pool size: leave 20% of cores free so OCR load can't starve the rest of the
// machine (AI extract, OS). Each worker gets OMP_NUM_THREADS capped at the pool
// size with OMP_DYNAMIC=TRUE, so a lone request can use most of the reserved
// cores while OpenMP itself scales worker threads down as others get busy.
const POOL_SIZE = Math.max(1, Math.floor(os.cpus().length * 0.8));

interface Worker {
  child: ChildProcessWithoutNullStreams | null;
  ready: Promise<void> | null;
  pending: Array<(line: string) => void>;
  inFlight: number;
}

const pool: Worker[] = Array.from({ length: POOL_SIZE }, () => ({ child: null, ready: null, pending: [] as Array<(line: string) => void>, inFlight: 0 }));

function startWorker(w: Worker): Promise<void> {
  const scriptPath = path.resolve(__dirname, '../../python/ocr.py');
  // OMP_WAIT_POLICY=PASSIVE: PaddlePaddle's OpenMP/MKL threads busy-spin on CPU
  // while idle by default, starving llama.cpp's CPU-side work during AI extract.
  const child = spawn('python3', [scriptPath, '--worker'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, OMP_WAIT_POLICY: 'PASSIVE', OMP_NUM_THREADS: String(POOL_SIZE), OMP_DYNAMIC: 'TRUE' },
  });
  w.child = child;

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => w.pending.shift()?.(line));

  child.on('exit', () => {
    w.child = null;
    w.ready = null;
    w.pending.splice(0).forEach((resolve) => resolve(JSON.stringify({ error: 'OCR worker exited' })));
  });

  return new Promise((resolve, reject) => {
    w.pending.push((line) => {
      try {
        JSON.parse(line).ready ? resolve() : reject(new Error('OCR worker failed to start'));
      } catch {
        reject(new Error(`OCR worker sent invalid startup line: ${line}`));
      }
    });
  });
}

function ensureWorker(w: Worker): Promise<void> {
  if (!w.child || !w.ready) w.ready = startWorker(w);
  return w.ready;
}

function requestOcr(w: Worker, filePath: string, debug = false): Promise<PythonOcrResult> {
  const child = w.child as ChildProcessWithoutNullStreams;
  return new Promise((resolve, reject) => {
    w.pending.push((line: string) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) reject(new Error(`VietOCR failed: ${parsed.error}`));
        else resolve(parsed as PythonOcrResult);
      } catch {
        reject(new Error(`VietOCR returned invalid JSON: ${line.slice(0, 200)}`));
      }
    });
    const cmd = debug ? JSON.stringify({ path: filePath, debug: true }) : filePath;
    child.stdin.write(cmd + '\n');
  });
}

function pickLeastBusy(): Worker {
  return pool.reduce((best, w) => (w.inFlight < best.inFlight ? w : best));
}

export async function ocrDocument(filePath: string, debug = false): Promise<PythonOcrResult> {
  // Each worker still serializes its own stdin/stdout (1 line in, 1 line out),
  // but requests fan out across the pool instead of a single global queue.
  const w = pickLeastBusy();
  w.inFlight++;
  try {
    await ensureWorker(w);
    return await requestOcr(w, filePath, debug);
  } finally {
    w.inFlight--;
  }
}
