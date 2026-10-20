"""Synthetic-only service checks. Never loads identity files or external services."""
import unittest
import time
import json
import http.client
import threading
from types import SimpleNamespace
from kyc_private_ocr_service import ResidentOcr, extract_fields, validate_payload, PrivateServer, MAX_BODY_BYTES


class FakeEngine:
    def __init__(self):
        self.calls = 0

    def __call__(self, payload):
        self.calls += 1
        if payload.get('stall'):
            time.sleep(5)
        return {'holderName': 'CALL ' + str(self.calls), 'unreadable': True}


def fake_factory(_root, _threads):
    return FakeEngine()


class ServiceTests(unittest.TestCase):
    def test_reuses_model_instance(self):
        with ResidentOcr('/tmp', 1, 2, fake_factory) as worker:
            self.assertEqual(worker.infer({})['holderName'], 'CALL 1')
            self.assertEqual(worker.infer({})['holderName'], 'CALL 2')

    def test_deadline_kills_worker_and_next_request_recovers(self):
        with ResidentOcr('/tmp', 1, 0.5, fake_factory) as worker:
            with self.assertRaises(TimeoutError):
                worker.infer({'stall': True})
            self.assertEqual(worker.infer({})['holderName'], 'CALL 1')

    def test_conflicting_document_numbers_are_not_guessed(self):
        result = extract_fields([('990101-14-0001', .9), ('990101-14-0002', .9)], 'national_id')
        self.assertTrue(result['unreadable'])
        self.assertIsNone(result['documentNumber'])

    def test_name_requires_label_and_number_is_unambiguous(self):
        result = extract_fields([('NAME', .99), ('SYNTHETIC TEST', .9), ('990101-14-0001', .95)], 'national_id')
        self.assertEqual(result['holderName'], 'SYNTHETIC TEST')
        self.assertEqual(result['documentNumber'], '990101140001')
        self.assertIsNone(extract_fields([('AN UNLABELLED LINE', .9)], 'national_id')['holderName'])

    def test_unknown_document_and_malformed_images_are_rejected(self):
        for value in [{}, {'documentType': 'unknown'}, {'documentType':'passport', 'front':{'mimeType':'image/jpeg','data':'not base64'},'back':{}}]:
            with self.assertRaises(ValueError):
                validate_payload(value)


class HttpTests(unittest.TestCase):
    def test_auth_limits_busy_and_response_allowlist(self):
        calls = []
        def infer(payload):
            calls.append(payload)
            return {'unreadable': True, 'rawText': 'must never escape'}
        worker = SimpleNamespace(infer=infer)
        with PrivateServer(('127.0.0.1', 0), worker, 'synthetic-secret-only', 2) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def post(body, headers):
                connection = http.client.HTTPConnection(*server.server_address, timeout=2)
                connection.request('POST', '/ocr', body, headers)
                response = connection.getresponse()
                status, data = response.status, response.read()
                connection.close()
                return status, data
            headers = {'Authorization':'Bearer synthetic-secret-only','Content-Type':'application/json'}
            try:
                self.assertEqual(post('{}', {})[0], 401)
                self.assertEqual(post(None, {**headers, 'Content-Length':str(MAX_BODY_BYTES + 1)})[0], 413)
                self.assertEqual(post('{}', headers)[0], 422)
                payload = json.dumps({'documentType':'national_id','front':{'mimeType':'image/png','data':'c3ludGhldGlj'},'back':{'mimeType':'image/png','data':'c3ludGhldGlj'}})
                status, body = post(payload, headers)
                self.assertEqual(status, 200)
                self.assertNotIn(b'rawText', body)
                server.admission.acquire()
                try:
                    self.assertEqual(post(None, headers)[0], 429)
                finally:
                    server.admission.release()
                self.assertEqual(len(calls), 1)
            finally:
                server.shutdown()
                thread.join()


if __name__ == '__main__':
    unittest.main()
