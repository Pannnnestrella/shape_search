import base64
import io
import json
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer

import numpy as np
from PIL import Image, ImageDraw
from model import canonical, ARTIFACT_DIR
from app import SearchEngine, make_handler


class PreprocessingTests(unittest.TestCase):
    def test_blank_and_transparent_canvas(self):
        with self.assertRaises(ValueError):
            canonical(Image.new('RGBA', (128, 128)))
        image = Image.new('RGBA', (128, 128), (255, 255, 255, 0))
        ImageDraw.Draw(image).ellipse((24, 24, 104, 104), outline='black', width=4)
        feature = canonical(image)
        self.assertEqual(feature.shape, (3, 224, 224))
        self.assertTrue(np.isfinite(feature).all())


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = SearchEngine('cuda')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(cls.engine))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'
        cls.target = next(icon for icon in cls.engine.icons if icon['id'] == 'lucide:search')
        cls.image = 'data:image/png;base64,' + base64.b64encode((ARTIFACT_DIR / cls.target['image']).read_bytes()).decode()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def post(self, payload):
        request = urllib.request.Request(self.url + '/search', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def test_health_and_exact_icon_retrieval(self):
        with urllib.request.urlopen(self.url + '/health') as response:
            health = json.load(response)
        self.assertTrue(health['ready'])
        self.assertEqual(health['count'], 16003)
        result = self.post({'image': self.image, 'sources': ['lucide'], 'limit': 200, 'includeIds': ['lucide:circle']})
        self.assertTrue(all(item['id'].startswith('lucide:') for item in result['candidates']))
        scores = {item['id']: item['score'] for item in result['candidates']}
        self.assertGreater(scores['lucide:search'], .99)
        self.assertIn('lucide:circle', scores)
        self.assertEqual(result['device'], 'cuda')

    def test_empty_sources_and_invalid_requests(self):
        self.assertEqual(self.post({'image': self.image, 'sources': []})['candidates'], [])
        for payload in [[], {'image': 'bad'}, {'image': self.image, 'sources': ['missing']}, {'image': self.image, 'limit': 0}]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.post(payload)
            self.assertEqual(error.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
