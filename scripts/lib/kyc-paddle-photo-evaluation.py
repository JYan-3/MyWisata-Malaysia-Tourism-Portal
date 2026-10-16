"""Local-only public-model comparison; no reference answer or identity data input."""
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import socket
import sys
import time

os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['DISABLE_MODEL_SOURCE_CHECK'] = 'True'
os.umask(0o077)


def deny_network(*_args, **_kwargs):
    raise RuntimeError('offline_ocr_network_denied')


# Public model files have already been downloaded; no remote image/URL input.
# This blocks Python socket access, not a kernel-level network sandbox.
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network

if len(sys.argv) != 5:
    raise ValueError('usage: model-directory first-photo second-photo output-directory')
model_root, first_photo, second_photo, output_directory = sys.argv[1:]
model_root = Path(model_root).resolve()
output = Path(output_directory).resolve()
output.mkdir(parents=True, exist_ok=True, mode=0o700)
for photo in [first_photo, second_photo]:
    if not Path(photo).is_file():
        raise ValueError('local_photo_required')

start = time.perf_counter()
from paddleocr import PaddleOCR  # noqa: E402

model_names = {
    'doc_orientation_classify': 'PP-LCNet_x1_0_doc_ori',
    'text_detection': 'PP-OCRv5_mobile_det',
    'text_recognition': 'latin_PP-OCRv5_mobile_rec',
    'textline_orientation': 'PP-LCNet_x1_0_textline_ori',
}
model_args = {}
for key, name in model_names.items():
    directory = model_root / name
    if not (directory / 'inference.json').is_file():
        raise ValueError('local_model_missing:' + name)
    model_args[key + '_model_name'] = name
    model_args[key + '_model_dir'] = str(directory)

ocr = PaddleOCR(**model_args, device='cpu', enable_mkldnn=False, cpu_threads=2,
                use_doc_orientation_classify=True, use_doc_unwarping=False,
                use_textline_orientation=True)
initialization_ms = round((time.perf_counter() - start) * 1000)
rows = []
cpu_start = time.process_time()


def recognize(local_input, doc_orientation, line_orientation):
    begin = time.perf_counter()
    result = ocr.predict(str(local_input), use_doc_orientation_classify=doc_orientation,
                         use_doc_unwarping=False, use_textline_orientation=line_orientation,
                         text_det_limit_side_len=1280, text_det_limit_type='max')
    elapsed = round((time.perf_counter() - begin) * 1000)
    texts, scores, angle = [], [], None
    for page in result:
        texts.extend(page['rec_texts'])
        scores.extend(float(value) for value in page['rec_scores'])
        preprocessing = page.get('doc_preprocessor_res')
        if preprocessing is not None:
            angle = preprocessing.get('angle')
    return {'ocrMs': elapsed, 'text': '\n'.join(texts),
            'engineScoresNotAccuracy': scores, 'documentAngle': angle}


for photo in ['photo1-human-rotated180', 'photo2-original',
              'photo1-human-rotated180-watermark', 'photo2-watermark']:
    crop = output / (photo + '-printed-crop.png')
    if not crop.is_file():
        raise ValueError('run_tesseract_preparation_first')
    observations = []
    for repeat in range(3):
        observation = recognize(crop, False, False)
        (output / (photo + '-paddle-run' + str(repeat + 1) + '.txt')).write_text(observation['text'])
        observations.append(observation)
    rows.append({'photo': photo, 'region': 'same-manual-printed-crop',
                 'docOrientation': False, 'lineOrientation': False,
                 'observations': observations})
    print('PADDLE_RESULT ' + json.dumps({'photo': photo, 'ms': [x['ocrMs'] for x in observations]}), flush=True)

whole_pages = []
for photo, local_file in [('photo1-as-received-upside-down', first_photo),
                          ('photo2-as-received', second_photo)]:
    for line_orientation in [False, True]:
        observations = []
        for repeat in range(3):
            observation = recognize(local_file, True, line_orientation)
            observations.append(observation)
            (output / (photo + '-paddle-whole-line-' + str(line_orientation) + '-run' + str(repeat + 1) + '.txt')).write_text(observation['text'])
        whole_pages.append({'photo': photo, 'docOrientation': True, 'lineOrientation': line_orientation,
                            'printedRegionScore': None, 'observations': observations})
        print('PADDLE_WHOLE ' + json.dumps({'photo': photo, 'lineOrientation': line_orientation,
              'angles': [x['documentAngle'] for x in observations],
              'ms': [x['ocrMs'] for x in observations]}), flush=True)

report = {
    'engine': 'PaddleOCR', 'versions': {name: importlib.metadata.version(name)
        for name in ['paddleocr', 'paddlepaddle', 'paddlex']},
    'models': model_names, 'device': 'cpu', 'cpuThreads': 2, 'maxDetectionImageSide': 1280,
    'unwarping': False, 'pythonNetworkBlocked': True,
    'initializationMs': initialization_ms, 'inferenceCpuSeconds': time.process_time() - cpu_start,
    'peakProcessRssMiB': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)),
    'rows': rows, 'wholePages': whole_pages,
    'limitations': ['Two photos only; tuning set, no independent holdout',
                    'Manual crop/corrected first-photo comparison is not automatic field detection',
                    'Whole-page text contains handwriting; no whole-page accuracy score',
                    'Python socket guard is not an OS network firewall',
                    'No KYC identity, real upload, production or hosting capacity verified'],
}
(output / 'paddle-raw-report.json').write_text(json.dumps(report, indent=2) + '\n')
