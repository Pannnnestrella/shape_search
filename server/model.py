"""Local DINOv2 encoding. Query and index use the same canonical preprocessing."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
import torch
from transformers import Dinov2Model

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = 'facebook/dinov2-small'
REVISION = 'ed25f3a31f01632728cabb09d1542f84ab7b0056'
MODEL_DIR = ROOT / 'models/dinov2-small'
ARTIFACT_DIR = ROOT / 'server/artifacts'
PREPROCESS_VERSION = 'ink-bbox-square-224-margin24-imagenet-v1'


def canonical(image):
    rgba = image.convert('RGBA')
    background = Image.new('RGBA', rgba.size, 'white')
    image = Image.alpha_composite(background, rgba).convert('RGB')
    pixels = np.asarray(image, dtype=np.float32)
    ink = 1 - (pixels @ np.array([.299, .587, .114], dtype=np.float32)) / 255
    ys, xs = np.where(ink > .15)
    if not len(xs) or (xs.max() - xs.min() < 2 and ys.max() - ys.min() < 2):
        raise ValueError('Blank sketch')
    crop = image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    scale = 176 / max(crop.size)
    resized = crop.resize(tuple(max(1, round(v * scale)) for v in crop.size), Image.Resampling.BILINEAR)
    output = Image.new('RGB', (224, 224), 'white')
    output.paste(resized, ((224 - resized.width) // 2, (224 - resized.height) // 2))
    array = np.asarray(output, dtype=np.float32) / 255
    return ((array - np.array([.485, .456, .406], dtype=np.float32)) /
            np.array([.229, .224, .225], dtype=np.float32)).transpose(2, 0, 1).copy()


def fingerprint_model():
    result = {}
    for filename in ['config.json', 'model.safetensors']:
        result[filename] = hashlib.sha256((MODEL_DIR / filename).read_bytes()).hexdigest()
    return result


class Encoder:
    def __init__(self, device='auto'):
        if device == 'auto':
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA unavailable; install CUDA PyTorch or explicitly select CPU')
        self.device = torch.device(device)
        self.dtype = torch.float16 if self.device.type == 'cuda' else torch.float32
        self.model = Dinov2Model.from_pretrained(str(MODEL_DIR), local_files_only=True,
                                                 dtype=self.dtype).to(self.device).eval()
        self.fingerprint = fingerprint_model()

    @torch.inference_mode()
    def encode(self, images):
        tensor = torch.from_numpy(np.stack([canonical(image) for image in images])).to(self.device, dtype=self.dtype)
        feature = self.model(pixel_values=tensor).last_hidden_state[:, 0].float()
        feature = torch.nn.functional.normalize(feature, dim=-1)
        return feature.cpu().numpy()

    def diagnostics(self):
        return {'device': str(self.device), 'precision': str(self.dtype), 'torch': torch.__version__,
                'gpu': torch.cuda.get_device_name(0) if self.device.type == 'cuda' else None,
                'peakAllocatedMiB': torch.cuda.max_memory_allocated() / 2**20 if self.device.type == 'cuda' else 0,
                'peakReservedMiB': torch.cuda.max_memory_reserved() / 2**20 if self.device.type == 'cuda' else 0}


def verify_sources(indexes):
    current = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / 'src/data/icons').glob('index-*.json'))}
    if current != indexes:
        raise ValueError('Icon indexes changed; rebuild model inputs and vectors')


def metadata(encoder, manifest):
    return {'version': 1, 'model': MODEL_ID, 'revision': REVISION,
            'preprocess': PREPROCESS_VERSION, 'modelFiles': encoder.fingerprint,
            'indexes': manifest['indexes'], 'icons': manifest['icons'], 'dimension': 384}
