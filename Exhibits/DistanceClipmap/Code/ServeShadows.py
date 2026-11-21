# ============================================================================================================================================
#                                                             SERVESHADOWS.PY
# ============================================================================================================================================
# 🧩 Serve the actual six-render comparison and native capture evidence; no browser rendering or editor integration is implied.

from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import argparse
from ServeTransport import TransportEvidenceRequest


# ------------------------------------------------------------------------------------------------------------------------
#                                                    EXHIBIT DOCUMENT RESOLUTION
# ------------------------------------------------------------------------------------------------------------------------

class ShadowEvidenceRequest(TransportEvidenceRequest):
    def ResolveDocument(Self):
        Address = urlsplit(Self.path)
        if Address.path == "/":
            Self.path = "/Shadows.html" + ("?" + Address.query if Address.query else "")


# ------------------------------------------------------------------------------------------------------------------------
#                                                        SERVER LIFETIME
# ------------------------------------------------------------------------------------------------------------------------

if __name__ == "__main__":
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--port", dest="Port", type=int, default=4175)
    Arguments = Parser.parse_args()
    Directory = Path(__file__).resolve().parents[1]
    RequestType = partial(ShadowEvidenceRequest, directory=str(Directory))
    with ThreadingHTTPServer(("0.0.0.0", Arguments.Port), RequestType) as Server:
        print(f"Six native SDF renders on port {Arguments.Port}; directory {Directory}", flush=True)
        Server.serve_forever()
