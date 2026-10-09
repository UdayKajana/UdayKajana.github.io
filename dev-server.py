#!/usr/bin/env python3
"""Local static server for development.

Same as `python3 -m http.server`, but sends `Cache-Control: no-cache` so the
browser revalidates every file (pages, iframe, ES modules under js/) on each
load. Plain http.server sends no cache header, which lets browsers reuse stale
module copies after an edit.

Usage: python3 dev-server.py [port]   (default 8000, binds 0.0.0.0)
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=str(Path(__file__).resolve().parent))
    print(f'Serving on http://localhost:{port} (no-cache)')
    ThreadingHTTPServer(('0.0.0.0', port), handler).serve_forever()
