import argparse
import json
import time
from pathlib import Path
import numpy as np
from PIL import Image
from model import ARTIFACT_DIR, MODEL_DIR, MODEL_ID, REVISION, Encoder, metadata, verify_sources


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['download', 'build', 'probe'])
    parser.add_argument('--device', choices=['auto', 'cuda', 'cpu'], default='auto')
    parser.add_argument('--batch-size', type=int, default=16)
    args = parser.parse_args()
    if args.command == 'download':
        from huggingface_hub import snapshot_download
        snapshot_download(MODEL_ID, revision=REVISION, local_dir=str(MODEL_DIR),
                          allow_patterns=['config.json', 'preprocessor_config.json', 'model.safetensors'])
        print(f'Model downloaded to {MODEL_DIR}', flush=True)
        return
    if args.batch_size < 1 or args.batch_size > 128:
        raise ValueError('batch size must be between 1 and 128')
    encoder = Encoder(args.device)
    if args.command == 'probe':
        image = Image.new('RGB', (224, 224), 'white')
        from PIL import ImageDraw
        ImageDraw.Draw(image).ellipse((40, 40, 180, 180), outline='black', width=4)
        start = time.perf_counter()
        feature = encoder.encode([image])
        print(json.dumps({'shape': list(feature.shape), 'norm': float(np.linalg.norm(feature)),
                          'elapsedMs': (time.perf_counter() - start) * 1000, **encoder.diagnostics()}, indent=2), flush=True)
        return
    manifest = json.loads((ARTIFACT_DIR / 'inputs.json').read_text(encoding='utf-8'))
    verify_sources(manifest['indexes'])
    vectors = []
    start = time.perf_counter()
    for offset in range(0, len(manifest['icons']), args.batch_size):
        images = []
        for icon in manifest['icons'][offset:offset + args.batch_size]:
            with Image.open(ARTIFACT_DIR / icon['image']) as image:
                images.append(image.copy())
        vectors.append(encoder.encode(images))
        if offset % (args.batch_size * 50) == 0:
            print(f'{offset + len(images)}/{len(manifest["icons"])} encoded', flush=True)
    matrix = np.concatenate(vectors)
    if matrix.shape != (len(manifest['icons']), 384) or not np.isfinite(matrix).all():
        raise ValueError('Invalid vector matrix')
    # Write complete files before replacing the live index.
    with (ARTIFACT_DIR / 'vectors.tmp').open('wb') as file:
        np.save(file, matrix)
    (ARTIFACT_DIR / 'vectors.tmp').replace(ARTIFACT_DIR / 'vectors.npy')
    info = metadata(encoder, manifest)
    info['vectorSha256'] = __import__('hashlib').sha256((ARTIFACT_DIR / 'vectors.npy').read_bytes()).hexdigest()
    info['build'] = {'elapsedSeconds': time.perf_counter() - start, 'batchSize': args.batch_size, **encoder.diagnostics()}
    (ARTIFACT_DIR / 'index.json').write_text(json.dumps(info, indent=2), encoding='utf-8')
    print(json.dumps(info['build'], indent=2), flush=True)


if __name__ == '__main__':
    main()
