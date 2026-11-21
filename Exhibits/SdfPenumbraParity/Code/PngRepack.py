#!/usr/bin/env python3
"""Repack the capture's stored-deflate PNG into a zlib level-9 PNG (decode-identical)."""
import struct, sys, zlib

def main(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8
    chunks = []
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        chunks.append((ctype, body))
        pos += 12 + length
    ihdr = dict(chunks)[b'IHDR']
    width, height = struct.unpack('>II', ihdr[:8])
    raw = b''
    for ctype, body in chunks:
        if ctype == b'IDAT':
            raw += zlib.decompress(body)
    stride = width * 3 + 1
    assert len(raw) == stride * height, (len(raw), stride * height)
    compressed = zlib.compress(raw, 9)
    out = b'\x89PNG\r\n\x1a\n'
    for ctype, body in chunks:
        if ctype == b'IDAT':
            body = compressed
        if ctype == b'IEND':
            body = b''
        out += struct.pack('>I', len(body)) + ctype + body + struct.pack('>I', zlib.crc32(ctype + body) & 0xFFFFFFFF)
    open(path, 'wb').write(out)
    print(f'repacked {path}: {len(out)} bytes')

if __name__ == '__main__':
    main(sys.argv[1])
