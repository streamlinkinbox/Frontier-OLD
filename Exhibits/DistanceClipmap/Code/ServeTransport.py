# ============================================================================================================================================
#                                                          SERVETRANSPORT.PY
# ============================================================================================================================================
# 🧩 Serve the retained GI exhibit, opening its comparison by default; not an editor or rendering server.

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import argparse


# ------------------------------------------------------------------------------------------------------------------------
#                                             EXHIBIT DOCUMENT RESOLUTION
# ------------------------------------------------------------------------------------------------------------------------

class TransportEvidenceRequest(SimpleHTTPRequestHandler):
    def ResolveDocument(Self):
        Address = urlsplit(Self.path)
        if Address.path == "/":
            Self.path = "/Gi.html" + ("?" + Address.query if Address.query else "")

    def do_GET(Self):
        Self.ResolveDocument()
        super().do_GET()

    def do_HEAD(Self):
        Self.ResolveDocument()
        super().do_HEAD()


# ------------------------------------------------------------------------------------------------------------------------
#                                                    SERVER LIFETIME
# ------------------------------------------------------------------------------------------------------------------------

if __name__ == "__main__":
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--port", type=int, default=4174)
    Arguments = Parser.parse_args()
    Directory = Path(__file__).resolve().parents[1]
    RequestType = partial(TransportEvidenceRequest, directory=str(Directory))
    with ThreadingHTTPServer(("0.0.0.0", Arguments.port), RequestType) as Server:
        print(f"GI evidence on port {Arguments.port}; directory {Directory}", flush=True)
        Server.serve_forever()
