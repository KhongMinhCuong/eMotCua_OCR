import contextlib
import json
import re
import sys
import time
from pathlib import Path

import cv2
import fitz
import numpy as np
import psutil
import pytesseract
from paddleocr import TextDetection
from PIL import Image
from vietocr.tool.config import Cfg
from vietocr.tool.predictor import Predictor

# CCCD (Vietnamese ID card) back side has a 3-line TD1 MRZ block that VietOCR
# (trained for Vietnamese prose, not monospace OCR-B digits/"<") reads poorly.
# Fallback: try the MRZ-shaped rows VietOCR already produced; if none look
# right, re-crop the bottom strip of the source image and re-OCR it with
# tesseract (better suited to this fixed monospace font).
MRZ_LINE_RE = re.compile(r'^[A-Z0-9<]{25,40}$')
MRZ_LINE2_RE = re.compile(r'(\d{6})\d([MF])(\d{6})\d?.{0,4}VNM')

# ponytail: regex-only, no ICAO check-digit validation, and misaligns on very
# noisy crops (stray duplicated digits shift the day/sex/expiry split). Good
# enough as a cross-check hint for the LLM prompt; add check-digit validation
# if wrong-but-plausible dates start showing up in practice.
def parse_mrz(lines: list[str]) -> dict | None:
    candidates = [l.strip().upper().replace(' ', '') for l in lines if l.strip()]
    candidates = [l for l in candidates if MRZ_LINE_RE.match(l)]
    if len(candidates) < 3:
        return None
    l1, l2, l3 = (c.ljust(30, '<')[:30] for c in candidates[-3:])
    # OCR confuses O/0 in the digit run; safe to fold since real line2 has no "O".
    # search (not match): stray/duplicated junk chars can shift the real fields.
    m = MRZ_LINE2_RE.search(l2.replace('O', '0'))
    if not m:
        return None
    dob, sex, exp = m.groups()

    def fmt(yymmdd: str, past_pivot: int) -> str:
        yy, mm, dd = yymmdd[0:2], yymmdd[2:4], yymmdd[4:6]
        century = '19' if int(yy) > past_pivot else '20'
        return f'{dd}/{mm}/{century}{yy}'

    # TD1 line1 often has the real ID duplicated/padded with extra leading digits
    # (doc number, check digits) from OCR noise; the LAST 9-12 digit run lines up
    # with the true 12-digit ID far more often than the first.
    id_matches = list(re.finditer(r'\d{9,12}', l1[5:]))
    return {
        'raw': f'{l1}\n{l2}\n{l3}',
        'soCCCD': id_matches[-1].group(0)[-12:] if id_matches else '',
        'ngaySinh': fmt(dob, past_pivot=30),
        'gioiTinh': {'M': 'Nam', 'F': 'Nữ'}.get(sex, ''),
        'ngayHetHan': fmt(exp, past_pivot=0),
        'hoTen': l3.replace('<<', ' ').replace('<', ' ').strip(),
    }

def mrz_from_image(image: np.ndarray) -> dict | None:
    h, w = image.shape[:2]
    if not (1.35 <= w / h <= 1.85):
        return None  # not ID-card shaped; skip the extra tesseract pass
    crop = image[int(h * 0.68):, :]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    # Fixed threshold beats Otsu here: the card's watermark pattern behind the
    # MRZ confuses Otsu's automatic split; MRZ ink is reliably darker than ~110.
    _, thresh = cv2.threshold(gray, 110, 255, cv2.THRESH_BINARY)
    text = pytesseract.image_to_string(
        thresh, config='--psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    )
    return parse_mrz(text.splitlines())

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

    # Only single-image (non-PDF) sources are ID-card photos in practice.
    if len(pages) == 1 and Path(file_path).suffix.lower() != '.pdf':
        out['mrz'] = parse_mrz(text.split('\n')) or mrz_from_image(pages[0])

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
