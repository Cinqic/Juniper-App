#!/usr/bin/env python3
"""Packaged-app regression fixture for the rc.31 blank Linux window.

rc.31 rendered nothing when stored state held an enabled Ollama provider and
Ollama answered with installed models: startup discovery threw inside a React
state update and unmounted the interface. This fixture recreates that state
against a local stand-in Ollama API so the packaged smoke exercises the path.

  serve <port-file> <request-log>   run a loopback /api/tags stand-in
  seed <juniper.db> <port>          add an enabled Ollama provider to stored state
  check <juniper.db>                require that discovered models were persisted
"""

import json
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "juniper-smoke:0.1b"
PROVIDER_ID = "ollama-smoke"


def serve(port_file, request_log):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            with open(request_log, "a", encoding="utf-8") as log:
                log.write(f"GET {self.path}\n")
            if self.path != "/api/tags":
                self.send_error(404)
                return
            body = json.dumps(
                {"models": [{"name": MODEL, "size": 1024, "modified_at": "2026-09-16T00:00:00Z"}]}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    with open(port_file, "w", encoding="utf-8") as handle:
        handle.write(str(server.server_address[1]))
    server.serve_forever()


def seed(database, port):
    connection = sqlite3.connect(database)
    (payload,) = connection.execute("SELECT payload FROM app_state WHERE id = 'singleton'").fetchone()
    state = json.loads(payload)
    template = state["providers"][0]
    state["providers"] = [
        provider for provider in state["providers"] if provider.get("id") != PROVIDER_ID
    ] + [
        {
            **template,
            "id": PROVIDER_ID,
            "name": "Ollama smoke stand-in",
            "kind": "ollama",
            "baseUrl": f"http://127.0.0.1:{port}",
            "locality": "local",
            "transportLocation": "on-device",
            "enabled": True,
            "status": "connected",
        }
    ]
    connection.execute(
        "UPDATE app_state SET payload = ? WHERE id = 'singleton'", (json.dumps(state),)
    )
    connection.commit()


def check(database):
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    (payload,) = connection.execute("SELECT payload FROM app_state WHERE id = 'singleton'").fetchone()
    models = [model.get("id") for model in json.loads(payload).get("models", [])]
    expected = f"{PROVIDER_ID}:{MODEL}"
    if expected not in models:
        raise SystemExit(f"discovered model {expected} was not persisted; stored models: {models}")
    print(f"persisted discovered model {expected}")


if __name__ == "__main__":
    command, *arguments = sys.argv[1:]
    {"serve": serve, "seed": seed, "check": check}[command](*arguments)
