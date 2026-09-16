import { execSync } from 'child_process';
import { config } from '../config';
import { MrzResult } from './ocr.service';
import { CCCD_FIELD_SCHEMA, CCCD_SYSTEM_PROMPT, CccdFields } from './cccd.prompt';
import { GCN_FIELD_SCHEMA, GCN_SYSTEM_PROMPT, ExtractedFields } from './gcn.prompt';

export type DocType = 'cccd' | 'gcn';
export { CccdFields, ExtractedFields };

export interface ExtractDebug {
  extract_s: number;
  vramBeforeMB: number | null;
  vramAfterMB: number | null;
  gpu: GpuStats | null;
  systemRam: SystemRamStats | null;
}

export interface GpuStats {
  name: string;
  memTotalMB: number;
  memUsedMB: number;
  memFreeMB: number;
  utilGpu: number;
  utilMem: number;
  tempC: number;
  powerW: number;
  processes: { pid: number; name: string; memMB: number }[];
}

export interface SystemRamStats {
  totalMB: number;
  usedMB: number;
  freeMB: number;
  availableMB: number;
  swapTotalMB: number;
  swapUsedMB: number;
  swapFreeMB: number;
}

export function getGpuStats(): GpuStats | null {
  try {
    const gpu = execSync(
      'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,temperature.gpu,power.draw --format=csv,noheader,nounits',
      { timeout: 3000 },
    ).toString().trim().split(',').map(s => s.trim());

    const procs: { pid: number; name: string; memMB: number }[] = [];
    try {
      const raw = execSync(
        'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits',
        { timeout: 2000 },
      ).toString().trim();
      if (raw) {
        for (const line of raw.split('\n')) {
          const [pid, name, mem] = line.split(',').map(s => s.trim());
          procs.push({ pid: parseInt(pid, 10), name, memMB: parseInt(mem, 10) || 0 });
        }
      }
    } catch { /* no processes */ }

    return {
      name: gpu[0],
      memTotalMB: parseInt(gpu[1], 10) || 0,
      memUsedMB: parseInt(gpu[2], 10) || 0,
      memFreeMB: parseInt(gpu[3], 10) || 0,
      utilGpu: parseInt(gpu[4], 10) || 0,
      utilMem: parseInt(gpu[5], 10) || 0,
      tempC: parseInt(gpu[6], 10) || 0,
      powerW: parseFloat(gpu[7]) || 0,
      processes: procs,
    };
  } catch {
    return null;
  }
}

export function getSystemRam(): SystemRamStats | null {
  try {
    const out = execSync('free -b', { timeout: 2000 }).toString().trim();
    const lines = out.split('\n');
    const mem = lines[1].split(/\s+/);
    const swap = lines[2].split(/\s+/);
    const toMB = (s: string) => Math.round(parseInt(s, 10) / 1024 / 1024);
    return {
      totalMB: toMB(mem[1]),
      usedMB: toMB(mem[2]),
      freeMB: toMB(mem[3]),
      availableMB: toMB(mem[6]),
      swapTotalMB: toMB(swap[1]),
      swapUsedMB: toMB(swap[2]),
      swapFreeMB: toMB(swap[3]),
    };
  } catch {
    return null;
  }
}

function gpuMemUsed(): number | null {
  try {
    const out = execSync('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits', { timeout: 2000 }).toString().trim();
    return parseInt(out, 10) || null;
  } catch {
    return null;
  }
}

export async function extractFields(
  fixedText: string,
  docType: DocType,
  debug = false,
  mrz?: MrzResult | null,
): Promise<ExtractedFields | CccdFields | { fields: ExtractedFields | CccdFields; debug: ExtractDebug }> {
  const vram0 = debug ? gpuMemUsed() : null;
  const t0 = Date.now();

  const isCccd = docType === 'cccd';
  const systemPrompt = isCccd ? CCCD_SYSTEM_PROMPT : GCN_SYSTEM_PROMPT;
  const schema = isCccd ? CCCD_FIELD_SCHEMA : GCN_FIELD_SCHEMA;
  const userContent = isCccd && mrz
    ? `${fixedText}\n\n--- MRZ ---\n${mrz.raw}\nsoCCCD:${mrz.soCCCD} ngaySinh:${mrz.ngaySinh} gioiTinh:${mrz.gioiTinh} ngayHetHan:${mrz.ngayHetHan} hoTen:${mrz.hoTen}`
    : fixedText;

  const response = await fetch(`${config.AI_SERVER_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      // llama.cpp enforces this schema via grammar-constrained decoding, so the
      // output is guaranteed valid JSON even from a small/weak model.
      response_format: { type: 'json_schema', json_schema: { name: 'fields', schema, strict: true } },
    }),
  });

  if (!response.ok) {
    throw new Error(`AI server failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  const fields = JSON.parse(body.choices[0].message.content) as ExtractedFields | CccdFields;

  if (!debug) return fields;
  return {
    fields,
    debug: {
      extract_s: Math.round((Date.now() - t0) / 1000 * 1000) / 1000,
      vramBeforeMB: vram0,
      vramAfterMB: gpuMemUsed(),
      gpu: getGpuStats(),
      systemRam: getSystemRam(),
    },
  };
}
