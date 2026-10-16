"""Bounded loopback acceptance, generated synthetic text only; no identity/file inputs."""
import base64
import http.client
import io
import json
from pathlib import Path
import secrets
import sys
import threading
import time
from PIL import Image, ImageDraw, ImageFont
from kyc_private_ocr_service import PrivateServer, ResidentOcr


def main():
    if len(sys.argv) != 2:
        raise ValueError('one_local_model_root_required')
    image = Image.new('RGB', (1600, 1000), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 52)
    for y, text in [(80, 'SYNTHETIC OCR TEST - NOT AN ID'), (230, 'NAME'), (330, 'SYNTHETIC TEST'), (540, '990101-14-0001')]:
        draw.text((90, y), text, font=font, fill='black')
    encoded = io.BytesIO()
    image.save(encoded, format='PNG')
    part = {'mimeType':'image/png','data':base64.b64encode(encoded.getvalue()).decode()}
    body = json.dumps({'documentType':'national_id','front':part,'back':part})
    token = secrets.token_urlsafe(32)
    started = time.perf_counter()
    with ResidentOcr(str(Path(sys.argv[1]).resolve(strict=True)), 1, 20) as worker:
        initialization = time.perf_counter() - started
        pid = worker.process.pid
        with PrivateServer(('127.0.0.1', 0), worker, token, 20) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            observations = []
            try:
                for _ in range(2):
                    connection = http.client.HTTPConnection(*server.server_address, timeout=25)
                    begin = time.perf_counter()
                    connection.request('POST','/ocr',body,{'Authorization':'Bearer '+token,'Content-Type':'application/json'})
                    response = connection.getresponse()
                    fields = json.loads(response.read())
                    connection.close()
                    assert response.status == 200, 'local_http_contract_failed'
                    observations.append({'requestMs':round((time.perf_counter()-begin)*1000),
                                         'syntheticNameExact':fields.get('holderName')=='SYNTHETIC TEST',
                                         'syntheticNumberExact':fields.get('documentNumber')=='990101140001'})
                reused = worker.process.pid == pid
                assert reused and all(row['syntheticNumberExact'] and row['syntheticNameExact'] for row in observations), 'synthetic_fields_or_reuse_failed'
                print(json.dumps({'syntheticOnly':True,'initializationMs':round(initialization*1000),
                                  'workerReused':reused,'requests':observations,
                                  'productionCapacityCertified':False,'identitySamples':0}))
            finally:
                server.shutdown()
                thread.join()


if __name__ == '__main__':
    main()
