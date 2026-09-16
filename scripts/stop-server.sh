#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"

stop_pid() {
  local pid_file="$1" label="$2"
  [[ -f "$pid_file" ]] || { echo "$label: không có pid file, bỏ qua."; return; }
  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "$label: đã dừng (pid $pid)."
  else
    echo "$label: process $pid không còn chạy."
  fi
  rm -f "$pid_file"
}

stop_pid "$RUN_DIR/api.pid" "OCR API"
stop_pid "$RUN_DIR/llama.pid" "llama.cpp"
