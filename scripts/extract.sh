#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="${API_URL:-http://127.0.0.1:3000/api/extract}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/results}"
DEBUG="${DEBUG:-0}"

[[ $# -gt 0 ]] || {
  echo "Dùng: $0 <file.pdf|image> [file2 ...]" >&2
  exit 1
}

if ! curl -fsS "${API_URL%/api/extract}/health" >/dev/null; then
  "$ROOT_DIR/scripts/start-server.sh"
fi

mkdir -p "$OUTPUT_DIR"

# Tất cả file truyền vào được coi là ảnh của CÙNG MỘT giấy tờ và gộp thành 1
# kết quả extract duy nhất (field "files", đúng 1 request tới API).
form_args=()
for input in "$@"; do
  [[ -f "$input" ]] || { echo "Không tìm thấy file: $input" >&2; continue; }
  form_args+=(-F "files=@$input")
done
[[ ${#form_args[@]} -gt 0 ]] || { echo "Không có file hợp lệ nào." >&2; exit 1; }

stem="$(basename "${1%.*}")"
output="$OUTPUT_DIR/$stem.json"
suffix=1
while [[ -e "$output" ]]; do
  output="$OUTPUT_DIR/${stem}_$suffix.json"
  ((suffix++))
done

url="$API_URL"
[[ "$DEBUG" == "1" ]] && url="${url}?debug=1"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📄 Trích xuất: $*"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

t_start=$(date +%s%N)
curl --fail-with-body -sS -X POST "$url" "${form_args[@]}" | python3 -m json.tool --no-ensure-ascii > "$output"
t_end=$(date +%s%N)
elapsed=$(( (t_end - t_start) / 1000000 ))

echo "✅ Đã lưu: $output (${elapsed}ms)"

if [[ "$DEBUG" == "1" && -f "$output" ]]; then
  echo ""
  python3 -c "
import json
d = json.load(open('$output'))
dbg = d.get('data', {}).get('debug')
if not dbg:
    print('Không có debug info')
    raise SystemExit

print('╔══════════════════════════════════════════╗')
print('║         DEBUG PERFORMANCE REPORT         ║')
print('╚══════════════════════════════════════════╝')

for i, ocr in enumerate(dbg.get('ocr') or [], 1):
    if not ocr:
        continue
    print(f'\n🔍 OCR Ảnh {i} ({ocr.get(\"total_ocr_s\", \"?\")}s, RAM {ocr.get(\"memStartMB\", \"?\")}→{ocr.get(\"memEndMB\", \"?\")} MB)')
    for j, p in enumerate(ocr.get('pages', []), 1):
        print(f'  Page {j}: {p[\"boxes\"]} boxes, {p[\"rows\"]} rows | detect {p[\"detect_s\"]}s, recognize {p[\"recognize_s\"]}s')
    print(f'  Load pages: {ocr.get(\"loadPages_s\", \"?\")}s')

ai = dbg.get('ai')
if ai:
    vram_before = ai.get('vramBeforeMB')
    vram_after = ai.get('vramAfterMB')
    vram_str = ''
    if vram_before is not None and vram_after is not None:
        delta = vram_after - vram_before
        vram_str = f', VRAM {vram_before}→{vram_after} MB (Δ{delta:+d})'
    print(f'\n🤖 AI Extract: {ai.get(\"extract_s\", \"?\")}s{vram_str}')

mem = dbg.get('memory', {})
print(f'\n💾 Node.js RSS: {mem.get(\"rssStartMB\", \"?\")}→{mem.get(\"rssPeakMB\", \"?\")} MB')

gpu = dbg.get('gpu') or (ai.get('gpu') if ai else None)
if gpu:
    procs = gpu.get('processes', [])
    llama_proc = next((p for p in procs if 'llama' in p.get('name', '')), None)
    llama_mb = llama_proc['memMB'] if llama_proc else None
    print(f'🎮 GPU: {gpu.get(\"name\", \"?\")} | VRAM {gpu.get(\"memUsedMB\",\"?\")}/{gpu.get(\"memTotalMB\",\"?\")} MB (free {gpu.get(\"memFreeMB\",\"?\")} MB)')
    print(f'   Util: {gpu.get(\"utilGpu\",\"?\")}% GPU, {gpu.get(\"utilMem\",\"?\")}% MEM | Temp {gpu.get(\"tempC\",\"?\")}°C | Power {gpu.get(\"powerW\",\"?\")}W')
    if llama_mb is not None:
        print(f'   llama.cpp: {llama_mb} MB VRAM')

sysram = dbg.get('systemRam') or (ai.get('systemRam') if ai else None)
if sysram:
    print(f'🧠 RAM: {sysram.get(\"usedMB\",\"?\")}/{sysram.get(\"totalMB\",\"?\")} MB (avail {sysram.get(\"availableMB\",\"?\")} MB) | Swap: {sysram.get(\"swapUsedMB\",\"?\")}/{sysram.get(\"swapTotalMB\",\"?\")} MB')

print(f'\n⏱  Total: {dbg.get(\"total_s\", \"?\")}s')
print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
"
fi
