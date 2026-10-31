"""Re-encode the textures embedded in the prop GLBs as WebP (EXT_texture_webp).

The Poly Haven props ship their normal/roughness maps as lossless 1k PNGs, which makes a
5,000-vertex planter weigh 12 MB. WebP keeps them visually identical at a fraction of the size.
Originals are copied to tools/asset-backups/models-original/ before anything is overwritten.
"""
import io
import json
import shutil
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'public' / 'assets' / 'models'
BACKUP = ROOT / 'tools' / 'asset-backups' / 'models-original'
TARGETS = ['planter', 'bench', 'lamp_post', 'desert_rock']
NORMAL_QUALITY = 92
QUALITY = 86


def read_glb(path):
    data = path.read_bytes()
    json_length = struct.unpack('<I', data[12:16])[0]
    document = json.loads(data[20:20 + json_length])
    offset = 20 + json_length
    binary_length = struct.unpack('<I', data[offset:offset + 4])[0]
    return document, data[offset + 8:offset + 8 + binary_length]


def write_glb(path, document, binary):
    def chunk(payload, kind, pad):
        payload += pad * ((4 - len(payload) % 4) % 4)
        return struct.pack('<I4s', len(payload), kind) + payload
    body = chunk(json.dumps(document, separators=(',', ':')).encode(), b'JSON', b' ') + chunk(binary, b'BIN\x00', b'\x00')
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 12 + len(body)) + body)


def to_webp(data, name):
    image = Image.open(io.BytesIO(data))
    has_alpha = image.mode in ('RGBA', 'LA') and image.getchannel('A').getextrema()[0] < 250
    image = image.convert('RGBA' if has_alpha else 'RGB')
    out = io.BytesIO()
    image.save(out, 'WEBP', quality=NORMAL_QUALITY if '_nor' in name else QUALITY, method=6)
    return out.getvalue()


def compress(name):
    path = MODELS / f'{name}.glb'
    document, binary = read_glb(path)
    if 'EXT_texture_webp' in document.get('extensionsUsed', []):
        print(f'{name}: already WebP, skipped')
        return
    BACKUP.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, BACKUP / path.name)
    views = document['bufferViews']
    payloads = [binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]
    for image in document.get('images', []):
        if 'bufferView' in image:
            payloads[image['bufferView']] = to_webp(payloads[image['bufferView']], image.get('name', ''))
            image['mimeType'] = 'image/webp'
    for texture in document.get('textures', []):
        if 'source' in texture:
            texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source': texture.pop('source')}
    for key in ('extensionsUsed', 'extensionsRequired'):
        document[key] = sorted(set(document.get(key, [])) | {'EXT_texture_webp'})
    # Repack every buffer view back to back, 4-byte aligned, in their original order.
    packed = bytearray()
    for view, payload in sorted(zip(views, payloads), key=lambda item: item[0].get('byteOffset', 0)):
        packed += b'\x00' * ((4 - len(packed) % 4) % 4)
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(payload)
        packed += payload
    document['buffers'][0]['byteLength'] = len(packed)
    before = path.stat().st_size
    write_glb(path, document, bytes(packed))
    print(f'{name}: {before / 1e6:.2f} MB -> {path.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    for target in TARGETS:
        compress(target)
