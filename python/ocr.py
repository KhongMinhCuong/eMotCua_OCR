import contextlib
import json
import sys
import time
from pathlib import Path

import cv2
import fitz
import numpy as np
import psutil
from paddleocr import TextDetection
from PIL import Image
from vietocr.tool.config import Cfg
from vietocr.tool.predictor import Predictor

_this_proc = psutil.Process()


def _mem_mb() -> float:
    return round(_this_proc.memory_info().rss / 1024 / 1024, 1)


def load_pages(source: Path) -> list[np.ndarray]:
    if source.suffix.lower() == '.pdf':
        document = fitz.open(source)
        pages = []
        for page in document:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = np.frombuffer(pixmap.samples, dtype=np.uint8)
            pages.append(image.reshape(pixmap.height, pixmap.width, pixmap.n))
        return pages

    image = cv2.imread(str(source))
    if image is None:
        raise ValueError('Unsupported or unreadable image')
    return [image]


def detect_lines(page: np.ndarray, detector: TextDetection) -> list[list[tuple[int, int, int, int]]]:
    result = detector.predict(page)[0]
    boxes = []
    for poly in result['dt_polys']:
        xs, ys = poly[:, 0], poly[:, 1]
        x, y = int(xs.min()), int(ys.min())
        w, h = int(xs.max() - x), int(ys.max() - y)
        if w >= 4 and h >= 4:
            boxes.append((x, y, w, h))

    boxes.sort(key=lambda box: (box[1], box[0]))
    rows: list[list[tuple[int, int, int, int]]] = []
    for box in boxes:
        center_y = box[1] + box[3] // 2
        for row in rows:
            row_center = sum(item[1] + item[3] // 2 for item in row) / len(row)
            row_height = max(item[3] for item in row)
            if abs(center_y - row_center) <= max(12, row_height // 2):
                row.append(box)
                break
        else:
            rows.append([box])

    return [sorted(row, key=lambda box: box[0]) for row in rows]


def process_file(file_path: str, detector: TextDetection, predictor: Predictor, debug: bool = False) -> dict:
    mem0 = _mem_mb()
    t0 = time.time()
    pages = load_pages(Path(file_path))
    t_load = round(time.time() - t0, 3)

    results = []
    for i, page in enumerate(pages):
        t_pd = time.time()
        rows = detect_lines(page, detector)
        t_detect = round(time.time() - t_pd, 3)

        t_pr = time.time()
        crops = []
        for row in rows:
            for x, y, w, h in row:
                margin = 4
                crop = page[max(0, y - margin): y + h + margin, max(0, x - margin): x + w + margin]
                crops.append(Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)))
        texts = predictor.predict_batch(crops) if crops else []
        t_recognize = round(time.time() - t_pr, 3)

        output_rows = []
        cursor = 0
        for row in rows:
            fields = [t.strip() for t in texts[cursor: cursor + len(row)] if t.strip()]
            cursor += len(row)
            if fields:
                output_rows.append('\t'.join(fields))

        results.append({
            'rows': len(rows),
            'boxes': len(crops),
            'detect_s': t_detect,
            'recognize_s': t_recognize,
            'text': '\n'.join(output_rows),
        })

    text = '\n\n'.join(r['text'] for r in results)
    out = {'rawText': text, 'pageCount': len(pages)}

    if debug:
        out['debug'] = {
            'loadPages_s': t_load,
            'pages': [{'boxes': r['boxes'], 'rows': r['rows'], 'detect_s': r['detect_s'], 'recognize_s': r['recognize_s']} for r in results],
            'total_ocr_s': round(time.time() - t0, 3),
            'memStartMB': mem0,
            'memEndMB': _mem_mb(),
        }
    return out


def main() -> None:
    config = Cfg.load_config_from_name('vgg_transformer')
    config['device'] = 'cpu'
    config['predictor']['beamsearch'] = False

    # vietocr/paddleocr print progress/cache notices straight to stdout; keep stdout JSON-only.
    with contextlib.redirect_stdout(sys.stderr):
        predictor = Predictor(config)
        # enable_mkldnn=False works around a PaddlePaddle/PaddleOCR PIR backend crash on this CPU build.
        detector = TextDetection(enable_mkldnn=False)

    # Worker mode (default): model loads once, stays resident; Node keeps this process
    # alive and sends JSON commands via stdin, reading one JSON result per line back.
    if len(sys.argv) >= 2 and sys.argv[1] != '--worker':
        debug = '--debug' in sys.argv
        print(json.dumps(process_file(sys.argv[1], detector, predictor, debug), ensure_ascii=False))
        return

    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            file_path = cmd['path']
            debug = cmd.get('debug', False)
        except (json.JSONDecodeError, KeyError):
            file_path = line
            debug = False
        try:
            result = process_file(file_path, detector, predictor, debug)
        except Exception as error:  # noqa: BLE001 - report to caller instead of crashing the worker
            result = {'error': str(error)}
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
