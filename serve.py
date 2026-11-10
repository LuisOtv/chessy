#!/usr/bin/env python3
"""Servidor local do Chessy: python3 serve.py [porta]

Envia os cabeçalhos de isolamento (COOP/COEP) para o navegador liberar várias
threads no WebAssembly. Sem eles a voz por IA roda numa thread só e fica lenta.
"""
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        # "credentialless" mantém funcionando imagens e scripts de outros sites (CDN, avatares)
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"Chessy rodando em http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), Handler).serve_forever()
