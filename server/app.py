import argparse
import base64
import hashlib
import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image, UnidentifiedImageError
from model import ARTIFACT_DIR, MODEL_ID, REVISION, PREPROCESS_VERSION, Encoder, verify_sources

Image.MAX_IMAGE_PIXELS = 4096 * 4096


class SearchEngine:
    def __init__(self, device='auto'):
        self.info = json.loads((ARTIFACT_DIR / 'index.json').read_text(encoding='utf-8'))
        verify_sources(self.info['indexes'])
        if self.info['model'] != MODEL_ID or self.info['revision'] != REVISION or self.info['preprocess'] != PREPROCESS_VERSION:
            raise ValueError('Model index version mismatch; rebuild vectors')
        self.encoder = Encoder(device)
        if self.info['modelFiles'] != self.encoder.fingerprint:
            raise ValueError('Model weights changed; rebuild vectors')
        vector_bytes = (ARTIFACT_DIR / 'vectors.npy').read_bytes()
        if hashlib.sha256(vector_bytes).hexdigest() != self.info['vectorSha256']:
            raise ValueError('Vector checksum mismatch')
        self.vectors = np.load(io.BytesIO(vector_bytes), allow_pickle=False)
        self.icons = self.info['icons']
        if self.vectors.shape != (len(self.icons), 384) or not np.isfinite(self.vectors).all():
            raise ValueError('Invalid vector matrix')
        if not np.allclose(np.linalg.norm(self.vectors, axis=1), 1, atol=.001):
            raise ValueError('Vectors are not normalized')
        self.sources = sorted({icon['source'] for icon in self.icons})
        self.lock = threading.Lock()

    def search(self, payload):
        sources = payload.get('sources', self.sources)
        if not isinstance(sources, list) or any(source not in self.sources for source in sources):
            raise ValueError('Invalid source selection')
        limit = payload.get('limit', 200)
        if not isinstance(limit, int) or not 1 <= limit <= 1000:
            raise ValueError('limit must be between 1 and 1000')
        include = payload.get('includeIds', [])
        if not isinstance(include, list) or len(include) > 1000 or any(not isinstance(item, str) for item in include):
            raise ValueError('Invalid included candidates')
        image = payload.get('image', '')
        if not isinstance(image, str) or not image.startswith('data:image/png;base64,'):
            raise ValueError('Expected PNG data URL')
        data = base64.b64decode(image.split(',', 1)[1], validate=True)
        with Image.open(io.BytesIO(data)) as raw:
            if raw.format != 'PNG' or raw.width * raw.height > 4096 * 4096:
                raise ValueError('Invalid image format or dimensions')
            query = raw.copy()
        start = time.perf_counter()
        with self.lock:
            vector = self.encoder.encode([query])[0]
            scores = self.vectors @ vector
            mask = np.array([icon['source'] in sources for icon in self.icons])
            indices = np.flatnonzero(mask)
            # Stable sort uses ID order as the deterministic tie breaker.
            indices = sorted(indices, key=lambda i: (-float(scores[i]), self.icons[i]['id']))
            candidates = set(indices[:limit])
            include_set = set(include)
            candidates.update(i for i in indices if self.icons[i]['id'] in include_set)
            ranked = sorted(candidates, key=lambda i: (-float(scores[i]), self.icons[i]['id']))
            return {'model': MODEL_ID, 'revision': REVISION, 'indexHashes': self.info['indexes'],
                    'candidates': [{'id': self.icons[i]['id'], 'score': float(scores[i])} for i in ranked],
                    'elapsedMs': (time.perf_counter() - start) * 1000, **self.encoder.diagnostics()}


def make_handler(engine):
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            origin = self.headers.get('Origin', '')
            from urllib.parse import urlparse
            parsed = urlparse(origin)
            if parsed.scheme == 'http' and parsed.hostname in ['localhost', '127.0.0.1']:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            origin = self.headers.get('Origin', '')
            from urllib.parse import urlparse
            parsed = urlparse(origin)
            if parsed.scheme == 'http' and parsed.hostname in ['localhost', '127.0.0.1']:
                self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.end_headers()

        def do_GET(self):
            if self.path != '/health':
                return self.send_json(404, {'error': 'Not found'})
            self.send_json(200, {'ready': True, 'model': MODEL_ID, 'count': len(engine.icons),
                                 'sources': engine.sources, **engine.encoder.diagnostics()})

        def do_POST(self):
            if self.path != '/search':
                return self.send_json(404, {'error': 'Not found'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 4 * 1024 * 1024:
                    return self.send_json(413, {'error': 'Request exceeds size limit'})
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict):
                    raise ValueError('Expected JSON object')
                result = engine.search(payload)
                self.send_json(200, result)
            except (ValueError, KeyError, TypeError, UnidentifiedImageError, Image.DecompressionBombError) as error:
                self.send_json(400, {'error': str(error)})
            except Exception as error:
                print(f'Search error: {error}', flush=True)
                self.send_json(503, {'error': 'Local inference failed; use geometry fallback'})
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8010)
    parser.add_argument('--device', choices=['auto', 'cuda', 'cpu'], default='auto')
    args = parser.parse_args()
    engine = SearchEngine(args.device)
    print(json.dumps({'ready': True, 'url': f'http://127.0.0.1:{args.port}', **engine.encoder.diagnostics()}), flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(engine)).serve_forever()
