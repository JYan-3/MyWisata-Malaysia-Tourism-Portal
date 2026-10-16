"""Local-only, resident private OCR prototype. No evidence/text logs or disk writes.

Requires preinstalled local models. Bind is loopback only. No production activation.
Python socket guard is defense in depth, not a substitute for an OS egress policy.
"""
import argparse
import base64
import contextlib
import hmac
import io
import json
import logging
import multiprocessing
import os
from pathlib import Path
import re
import socket
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_BODY_BYTES = 14 * 1024 * 1024  # Two existing 5 MiB images, base64 plus JSON.
MODEL_NAMES = {'doc_orientation_classify': 'PP-LCNet_x1_0_doc_ori',
               'text_detection': 'PP-OCRv5_mobile_det',
               'text_recognition': 'latin_PP-OCRv5_mobile_rec',
               'textline_orientation': 'PP-LCNet_x1_0_textline_ori'}
MIME_FORMATS = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}


def validate_payload(payload):
    if not isinstance(payload, dict) or payload.get('documentType') not in ('national_id', 'driving_license', 'passport'):
        raise ValueError('invalid_payload')
    images = []
    for side in ('front', 'back'):
        part = payload.get(side)
        if not isinstance(part, dict) or part.get('mimeType') not in MIME_FORMATS or not isinstance(part.get('data'), str):
            raise ValueError('invalid_image')
        try:
            raw = base64.b64decode(part['data'], validate=True)
        except Exception:
            raise ValueError('invalid_image') from None
        if not raw or len(raw) > MAX_IMAGE_BYTES:
            raise ValueError('invalid_image')
        images.append((raw, part['mimeType']))
    return images


def extract_fields(rows, document_type):
    """Conservative field extraction. Ambiguous or unlabelled values stay unknown."""
    numbers, names, scores = set(), set(), []
    pattern = re.compile(r'(?<!\d)\d{6}[- ]?\d{2}[- ]?\d{4}(?!\d)')
    labels = {'NAME', 'NAMA', 'FULL NAME', 'NAMA PENUH'}
    for index, (raw, score) in enumerate(rows):
        text = str(raw).strip().upper()
        candidates = pattern.findall(text) if document_type != 'passport' else ([text] if re.fullmatch(r'[A-Z]{1,2}\d{6,8}', text) else [])
        for number in candidates:
            numbers.add(re.sub(r'[- ]', '', number))
            scores.append(float(score))
        if text.rstrip(':') in labels and index + 1 < len(rows):
            value, confidence = rows[index + 1]
            value = str(value).strip()
            if 1 < len(value) <= 160 and not any(c.isdigit() for c in value):
                names.add(value)
                scores.append(float(confidence))
        elif ':' in text and text.split(':', 1)[0].strip() in labels:
            value = str(raw).split(':', 1)[1].strip()
            if 1 < len(value) <= 160 and not any(c.isdigit() for c in value):
                names.add(value)
                scores.append(float(score))
    number = next(iter(numbers)) if len(numbers) == 1 else None
    confidence = min(scores) if scores and all(0 <= value <= 1 for value in scores) else None
    return {'holderName': next(iter(names)) if len(names) == 1 else None,
            'documentNumber': number, 'expiryDate': None, 'confidence': confidence,
            'unreadable': number is None}


def paddle_factory(models_root, cpu_threads):
    from paddleocr import PaddleOCR
    from PIL import Image
    import numpy as np
    root = Path(models_root).resolve(strict=True)
    args = {}
    for key, name in MODEL_NAMES.items():
        directory = (root / name).resolve(strict=True)
        if not directory.is_relative_to(root) or not (directory / 'inference.json').is_file():
            raise ValueError('local_models_required')
        args[key + '_model_name'] = name
        args[key + '_model_dir'] = str(directory)
    engine = PaddleOCR(**args, device='cpu', cpu_threads=cpu_threads, enable_mkldnn=False,
                       use_doc_orientation_classify=True, use_doc_unwarping=False, use_textline_orientation=True)

    def infer(payload):
        rows = []
        for raw, mime in validate_payload(payload):
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != MIME_FORMATS[mime] or image.width * image.height > 20_000_000 or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('invalid_image')
                pixels = np.asarray(image.convert('RGB'))
            for page in engine.predict(pixels, text_det_limit_side_len=1280, text_det_limit_type='max'):
                texts, confidence = page.get('rec_texts', []), page.get('rec_scores', [])
                if len(texts) > 256 or len(texts) != len(confidence):
                    raise ValueError('unsupported_result')
                rows.extend(zip(texts, confidence))
        return extract_fields(rows, payload['documentType'])
    return infer


def engine_worker(connection, root, threads, factory):
    # No application credentials or user-home caches reach the model process.
    os.environ.clear()
    os.environ.update({'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C.UTF-8', 'TMPDIR': '/tmp',
                       'PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK': 'True', 'HF_HUB_OFFLINE': '1',
                       'TRANSFORMERS_OFFLINE': '1', 'OMP_NUM_THREADS': str(threads), 'MKL_NUM_THREADS': str(threads)})
    os.umask(0o077)
    logging.disable(logging.CRITICAL)
    def deny(*_args, **_kwargs):
        raise RuntimeError('offline_network_denied')
    socket.socket.connect = deny
    socket.socket.connect_ex = deny
    socket.create_connection = deny
    try:
        with tempfile.TemporaryDirectory(prefix='mywisata-resident-ocr-') as cache:
            os.environ.update({'HOME': cache, 'PADDLE_PDX_CACHE_HOME': cache, 'XDG_CACHE_HOME': cache})
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                infer = factory(root, threads)
                connection.send({'ready': True})
                while True:
                    payload = connection.recv()
                    if payload is None:
                        break
                    try:
                        connection.send({'result': infer(payload)})
                    except ValueError:
                        connection.send({'error': 'invalid_image'})
                    except Exception:
                        connection.send({'error': 'engine_unavailable'})
                    finally:
                        payload = None
    except (EOFError, BrokenPipeError):
        pass
    except Exception:
        try:
            connection.send({'error': 'engine_unavailable'})
        except (EOFError, BrokenPipeError):
            pass
    finally:
        connection.close()


class ResidentOcr:
    def __init__(self, root, threads, timeout, factory=paddle_factory):
        self.root, self.threads, self.timeout, self.factory = root, threads, timeout, factory
        self.process, self.connection = None, None
        self.lock = threading.Lock()

    def _stop(self):
        if self.process:
            self.process.terminate()
            self.process.join(timeout=1)
            if self.process.is_alive():
                self.process.kill()
                self.process.join()
            self.process.close()
        if self.connection:
            self.connection.close()
        self.process, self.connection = None, None

    def _start(self):
        if self.process and self.process.is_alive():
            return
        self._stop()
        context = multiprocessing.get_context('spawn')
        self.connection, child = context.Pipe()
        self.process = context.Process(target=engine_worker, args=(child, self.root, self.threads, self.factory), daemon=True)
        self.process.start()
        child.close()
        if not self.connection.poll(self.timeout) or self.connection.recv().get('ready') is not True:
            self._stop()
            raise TimeoutError('engine_start_failed')

    def infer(self, payload):
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError('engine_busy')
        try:
            self._start()
            self.connection.send(payload)
            if not self.connection.poll(self.timeout):
                self._stop()  # No background inference survives the hard deadline.
                raise TimeoutError('engine_timeout')
            reply = self.connection.recv()
            if reply.get('error'):
                if reply['error'] == 'invalid_image':
                    raise ValueError('invalid_image')
                self._stop()
                raise RuntimeError('engine_unavailable')
            return reply['result']
        except TimeoutError:
            raise
        except (EOFError, BrokenPipeError, OSError):
            self._stop()
            raise RuntimeError('engine_unavailable') from None
        finally:
            self.lock.release()

    def __enter__(self):
        self._start()
        return self

    def __exit__(self, *_args):
        self._stop()


class PrivateServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, worker, token, timeout):
        self.worker, self.token, self.timeout = worker, token, timeout
        self.admission = threading.BoundedSemaphore(1)
        self.slots = threading.BoundedSemaphore(2)  # One inference and one fast rejection.
        super().__init__(address, Handler)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b'HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
            self.shutdown_request(request)
            return
        request.settimeout(self.timeout)
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, *_args):
        pass  # Never print a request, body, secret, or model exception.


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        body = json.dumps(value, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_POST(self):
        if self.path != '/ocr':
            return self.reply(404, {'error': 'not_found'})
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + self.server.token):
            return self.reply(401, {'error': 'unauthorized'})
        if not self.server.admission.acquire(blocking=False):
            return self.reply(429, {'error': 'busy'})
        try:
            return self.infer_request()
        finally:
            self.server.admission.release()

    def infer_request(self):
        if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(400, {'error': 'invalid_request'})
        try:
            if len(self.headers.get_all('Content-Length', [])) != 1:
                raise ValueError('invalid_request')
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > MAX_BODY_BYTES:
                return self.reply(413, {'error': 'request_too_large'})
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('incomplete_request')
            payload = json.loads(raw)
            validate_payload(payload)
            result = self.server.worker.infer(payload)
            return self.reply(200, {key: result.get(key) for key in ('holderName', 'documentNumber', 'expiryDate', 'confidence', 'unreadable')})
        except ValueError:
            return self.reply(422, {'error': 'invalid_image'})
        except BlockingIOError:
            return self.reply(429, {'error': 'busy'})
        except TimeoutError:
            return self.reply(503, {'error': 'engine_timeout'})
        except Exception:
            return self.reply(503, {'error': 'engine_unavailable'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models-root', required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--timeout-ms', type=int, required=True)
    parser.add_argument('--cpu-threads', type=int, required=True)
    args = parser.parse_args()
    token = os.environ.get('KYC_PRIVATE_OCR_TOKEN', '')
    if len(token) < 16 or not 1 <= args.port <= 65535 or not 1000 <= args.timeout_ms <= 120000 or not 1 <= args.cpu_threads <= 4:
        parser.error('valid explicit local budgets and KYC_PRIVATE_OCR_TOKEN (16+ characters) required')
    with ResidentOcr(args.models_root, args.cpu_threads, args.timeout_ms / 1000) as worker:
        with PrivateServer(('127.0.0.1', args.port), worker, token, args.timeout_ms / 1000) as server:
            server.serve_forever()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        raise SystemExit('private_ocr_service_unavailable') from None
