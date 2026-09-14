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
