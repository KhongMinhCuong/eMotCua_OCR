#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$RUN_DIR"

AI_SERVER_URL="${AI_SERVER_URL:-http://127.0.0.1:8080}"
PORT="${PORT:-3000}"
LLAMA_BIN="${LLAMA_BIN:-$HOME/.local/bin/llama}"
LLAMA_MODEL="${LLAMA_MODEL:-Qwen/Qwen2.5-3B-Instruct-GGUF:Q4_K_M}"
LLAMA_CTX_SIZE="${LLAMA_CTX_SIZE:-8192}"
LLAMA_GPU_LAYERS="${LLAMA_GPU_LAYERS:-99}"

if ! curl -fsS "$AI_SERVER_URL/health" >/dev/null; then
  [[ -x "$LLAMA_BIN" ]] || { echo "Không tìm thấy llama binary: $LLAMA_BIN" >&2; exit 1; }

  if [[ -f "$LLAMA_MODEL" ]]; then
    model_args=(-m "$LLAMA_MODEL")
  else
    model_args=(-hf "$LLAMA_MODEL")
  fi

  # Trong distrobox (Ubuntu container trên host Fedora/Nobara), ICD Vulkan
  # của NVIDIA trỏ tới /usr/lib64/libGLX_nvidia.so.0 (quy ước Fedora) nhưng
  # container không có đường dẫn đó -> Vulkan chỉ thấy GPU onboard (AMD/Intel).
  # Ghi ICD với đường dẫn đúng cho Ubuntu rồi trỏ VK_ICD_FILENAMES vào đó.
  nvidia_lib="/usr/lib/x86_64-linux-gnu/libGLX_nvidia.so.0"
  if [[ -f "$nvidia_lib" && -z "${VK_ICD_FILENAMES:-}" ]]; then
    icd_json="$RUN_DIR/nvidia_icd.json"
    cat >"$icd_json" <<EOF
{"file_format_version":"1.0.1","ICD":{"library_path":"$nvidia_lib","api_version":"1.4.329"}}
EOF
    export VK_ICD_FILENAMES="$icd_json"
  fi

  "$LLAMA_BIN" serve "${model_args[@]}" --port 8080 --ctx-size "$LLAMA_CTX_SIZE" -ngl "$LLAMA_GPU_LAYERS" \
    >"$RUN_DIR/llama.log" 2>&1 &
  echo "$!" >"$RUN_DIR/llama.pid"
  echo "Đang khởi động llama.cpp..."

  for _ in {1..60}; do
    curl -fsS "$AI_SERVER_URL/health" >/dev/null && break
    sleep 1
  done
  curl -fsS "$AI_SERVER_URL/health" >/dev/null || { echo "llama.cpp không khởi động được. Xem $RUN_DIR/llama.log" >&2; exit 1; }
else
  echo "llama.cpp đã chạy tại $AI_SERVER_URL"
fi

if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "OCR API đã chạy tại http://127.0.0.1:$PORT"
  exit 0
fi

cd "$ROOT_DIR"
npm run build
nohup node dist/index.js >"$RUN_DIR/api.log" 2>&1 &
echo "$!" >"$RUN_DIR/api.pid"

for _ in {1..20}; do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null || { echo "OCR API không khởi động được. Xem $RUN_DIR/api.log" >&2; exit 1; }
echo "Sẵn sàng: POST http://127.0.0.1:$PORT/api/extract"
