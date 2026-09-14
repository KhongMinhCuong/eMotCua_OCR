import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import readline from 'readline';
import path from 'path';

interface PythonOcrResult {
  rawText: string;
  pageCount: number;
  debug?: {
    loadPages_s: number;
    pages: Array<{ boxes: number; rows: number; detect_s: number; recognize_s: number }>;
    total_ocr_s: number;
    memStartMB: number;
    memEndMB: number;
  };
}

// Model load (~9s) happens once per process, not per request: keep one Python worker
// alive for the life of the Node process and feed it file paths over stdin.
let worker: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function startWorker(): Promise<void> {
  const scriptPath = path.resolve(__dirname, '../../python/ocr.py');
  // OMP_WAIT_POLICY=PASSIVE: PaddlePaddle's OpenMP/MKL threads busy-spin on CPU
  // while idle by default, starving llama.cpp's CPU-side work during AI extract.
  const child = spawn('python3', [scriptPath, '--worker'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, OMP_WAIT_POLICY: 'PASSIVE' },
  });
  worker = child;

  const lines = readline.createInterface({ input: child.stdout });
  const pending: Array<(line: string) => void> = [];
  (child as any)._pending = pending;
  lines.on('line', (line) => pending.shift()?.(line));

  child.on('exit', () => {
    worker = null;
    ready = null;
    pending.splice(0).forEach((resolve) => resolve(JSON.stringify({ error: 'OCR worker exited' })));
  });

  return new Promise((resolve, reject) => {
    pending.push((line) => {
      try {
        JSON.parse(line).ready ? resolve() : reject(new Error('OCR worker failed to start'));
      } catch {
        reject(new Error(`OCR worker sent invalid startup line: ${line}`));
      }
    });
  });
}

function ensureWorker(): Promise<void> {
  if (!worker || !ready) ready = startWorker();
  return ready;
}

function requestOcr(filePath: string, debug = false): Promise<PythonOcrResult> {
  const child = worker as ChildProcessWithoutNullStreams;
  return new Promise((resolve, reject) => {
    (child as any)._pending.push((line: string) => {
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

export function ocrDocument(filePath: string, debug = false): Promise<PythonOcrResult> {
  // Serialize requests: the worker reads one line in, writes one line out — no
  // interleaving multiple files through the same stdin/stdout pipe at once.
  const result = queue.then(() => ensureWorker()).then(() => requestOcr(filePath, debug));
  queue = result.catch(() => undefined);
  return result;
}
