#!/usr/bin/env python3
"""Static HTTP server for Frontier Landscape SDF Studio (binds 0.0.0.0)."""

import http.server
import mimetypes
import os
import posixpath
import sys
import urllib.parse

THIS_DIR = os.path.abspath(os.path.dirname(__file__))

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("font/woff2", ".woff2")


class LandscapePreviewHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
        clean = posixpath.normpath(parsed).lstrip("/")
        if clean in ("", "."):
            return os.path.join(THIS_DIR, "index.html")
        candidate = os.path.abspath(os.path.join(THIS_DIR, clean))
        if candidate.startswith(THIS_DIR) and os.path.exists(candidate):
            return candidate
        return os.path.join(THIS_DIR, "index.html")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4180
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), LandscapePreviewHandler)
    print(f"Frontier Landscape SDF Studio listening on http://0.0.0.0:{port}/", flush=True)
    server.serve_forever()
