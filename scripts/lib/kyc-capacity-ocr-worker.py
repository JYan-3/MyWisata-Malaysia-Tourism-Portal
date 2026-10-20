"""Offline, synthetic-only Paddle timing probe. It never accepts image paths."""
import contextlib
import io
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import resource
import socket
import sys
import tempfile
import time

os.environ.clear()
os.environ.update({
    'PATH': '/usr/bin:/bin',
    'TMPDIR': '/tmp',
    'LANG': 'C.UTF-8',
    'PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK': 'True',
    'HF_HUB_OFFLINE': '1',
    'TRANSFORMERS_OFFLINE': '1',
    'DISABLE_MODEL_SOURCE_CHECK': 'True',
    'OMP_NUM_THREADS': '1',
    'MKL_NUM_THREADS': '1',
})
os.umask(0o077)
logging.disable(logging.CRITICAL)


def deny_network(*_args, **_kwargs):
    raise RuntimeError('offline_network_denied')


socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network


def safe_root(candidate):
    configured_root = Path('/tmp/mywisata-paddle-ocr-runtime')
    if configured_root.is_symlink():
        raise ValueError('runtime_root_must_not_be_a_symlink')
    allowed_root = configured_root.resolve(strict=True)
    models_root = Path(candidate).resolve(strict=True)
    if not models_root.is_relative_to(allowed_root):
        raise ValueError('model_root_outside_preinstalled_local_runtime')
    required = [
        'PP-LCNet_x1_0_doc_ori',
        'PP-OCRv5_mobile_det',
        'latin_PP-OCRv5_mobile_rec',
        'PP-LCNet_x1_0_textline_ori',
    ]
    for name in required:
        model_dir = (models_root / name).resolve(strict=True)
        if not model_dir.is_relative_to(models_root) or not (model_dir / 'inference.json').is_file():
            raise ValueError('preinstalled_model_files_missing')
    return models_root


def durations(values):
    ordered = sorted(values)
    if not ordered:
        return {'samples': 0, 'meanMs': None, 'medianMs': None, 'p95Ms': None, 'maxMs': None}
    middle = len(ordered) // 2
    median = ordered[middle] if len(ordered) % 2 else round((ordered[middle - 1] + ordered[middle]) / 2)
    return {
        'samples': len(ordered),
        'meanMs': round(sum(ordered) / len(ordered)),
        'medianMs': median,
        'p95Ms': ordered[max(0, int(len(ordered) * 0.95 + 0.999999) - 1)],
        'maxMs': ordered[-1],
    }


def make_synthetic_images():
    from PIL import Image, ImageDraw, ImageFilter
    import numpy as np

    image = Image.new('RGB', (1800, 1120), '#f8fafc')
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, 1760, 1080), outline='#475569', width=8)
    draw.text((100, 240), 'SYNTHETIC OCR CAPACITY TEST', fill='#111827')
    draw.text((100, 480), 'SAMPLE FRONT - NOT A REAL DOCUMENT', fill='#111827')
    draw.text((100, 680), 'TEST ONLY 0000', fill='#111827')
    clean = image
    rotated = clean.rotate(4, resample=Image.Resampling.BICUBIC, fillcolor='white')
    reduced = clean.resize((900, 560), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    reduced = reduced.resize((1800, 1120), Image.Resampling.LANCZOS)
    return [np.asarray(value) for value in (clean, rotated, reduced)]


def main():
    if len(sys.argv) != 3:
        raise ValueError('invalid_worker_arguments')
    models_root = safe_root(sys.argv[1])
    cases = int(sys.argv[2])
    if cases < 1 or cases > 20:
        raise ValueError('case_count_outside_local_safety_range')

    with tempfile.TemporaryDirectory(prefix='mywisata-capacity-', dir='/tmp') as cache_root:
        os.chmod(cache_root, 0o700)
        os.environ.update({'HOME': cache_root, 'XDG_CACHE_HOME': cache_root, 'PADDLE_HOME': cache_root})
        from paddleocr import PaddleOCR

        model_names = {
            'doc_orientation_classify': 'PP-LCNet_x1_0_doc_ori',
            'text_detection': 'PP-OCRv5_mobile_det',
            'text_recognition': 'latin_PP-OCRv5_mobile_rec',
            'textline_orientation': 'PP-LCNet_x1_0_textline_ori',
        }
        model_args = {}
        for key, name in model_names.items():
            model_args[key + '_model_name'] = name
            model_args[key + '_model_dir'] = str(models_root / name)

        start = time.perf_counter()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ocr = PaddleOCR(**model_args, device='cpu', enable_mkldnn=False, cpu_threads=1,
                            use_doc_orientation_classify=True, use_doc_unwarping=False,
                            use_textline_orientation=True)
        initialization_ms = round((time.perf_counter() - start) * 1000)
        images = make_synthetic_images()
        rows = []
        cpu_start = time.process_time()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            for variant, image in enumerate(images):
                observations = []
                for _ in range(cases):
                    begin = time.perf_counter()
                    # Result object is deliberately discarded: no OCR text is read or written.
                    ocr.predict(image, use_doc_orientation_classify=True, use_doc_unwarping=False,
                                use_textline_orientation=True, text_det_limit_side_len=1280,
                                text_det_limit_type='max')
                    observations.append((time.perf_counter() - begin) * 1000)
                rows.append({'variant': ['synthetic_clean', 'synthetic_rotated', 'synthetic_reduced_blurred'][variant],
                             'ocrWallTime': durations(observations)})
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        peak_rss_mib = round(rss / (1024 * 1024)) if sys.platform == 'darwin' else round(rss / 1024)
        return {
            'engine': 'PaddleOCR',
            'engineVersions': {name: importlib.metadata.version(name) for name in ('paddleocr', 'paddlepaddle', 'paddlex')},
            'pythonVersion': sys.version.split()[0],
            'modelNames': ['PP-LCNet_x1_0_doc_ori', 'PP-OCRv5_mobile_det', 'latin_PP-OCRv5_mobile_rec', 'PP-LCNet_x1_0_textline_ori'],
            'mode': 'one_local_worker_sequential_synthetic_only',
            'casesPerVariant': cases,
            'imagesPerCase': 1,
            'imagePixels': [1800, 1120],
            'cpuThreads': 1,
            'syntheticTextLanguage': 'English',
            'samplesIndependentForAccuracy': False,
            'pythonSocketAccess': 'blocked_by_process_guard_not_an_os_firewall',
            'ocrTextReported': False,
            'initializationMs': initialization_ms,
            'inferenceCpuSeconds': round(time.process_time() - cpu_start, 3),
            'workerPeakRssMiB': peak_rss_mib,
            'workerPeakRssSource': 'resource.getrusage(RUSAGE_SELF); excludes parent process; platform-normalized',
            'rows': rows,
            'limitations': ['No identity images, OCR text, storage, database, concurrent worker set, or hosting plan were tested.'],
        }


if __name__ == '__main__':
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = main()
        print('KYC_CAPACITY_RESULT ' + json.dumps(result, separators=(',', ':')))
    except Exception:
        print('KYC_CAPACITY_ERROR local_worker_failed', file=sys.stderr)
        sys.exit(1)
