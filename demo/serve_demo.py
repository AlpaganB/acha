import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pydantic import ValidationError

from crew_app import CONFIG, ROOT, database

ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/app.css": ("app.css", "text/css; charset=utf-8"),
          "/sw.js": ("sw.js", "text/javascript; charset=utf-8")}


def dispatch(store, method, path, body=None):
    if method == "GET" and path in ASSETS:
        name, mime = ASSETS[path]
        return 200, mime, (ROOT / "web" / name).read_bytes()
    if method == "GET" and path == "/api/config":
        value = CONFIG
    elif method == "GET" and path == "/api/history":
        value = store.snapshot()
    elif method == "POST" and path == "/api/checkins":
        value = store.assess(body)
    elif method == "POST" and path == "/api/sync":
        value = store.synchronize()
    else:
        return json_response(404, {"error": "Route not found."})
    return json_response(200, value)


def json_response(status, value):
    return status, "application/json; charset=utf-8", json.dumps(value, allow_nan=False).encode("utf-8")


def handle(store, method, path, content_type, raw, origin, host):
    if method == "POST":
        if origin and origin != "http://" + host:
            return json_response(403, {"error": "Use the onboard app for write requests."})
        if content_type.split(";")[0] != "application/json":
            return json_response(415, {"error": "Send a JSON request."})
    try:
        return dispatch(store, method, path, json.loads(raw) if raw else None)
    except ValidationError as exc:
        return json_response(422, {"error": exc.errors(include_context=False, include_input=False, include_url=False)[0]["msg"]})
    except (ValueError, OverflowError) as exc:
        return json_response(400, {"error": str(exc)})


def build_server(store, port):
    class Handler(BaseHTTPRequestHandler):
        def request(self):
            if self.headers.get("Host", "").split(":")[0] not in {"localhost", "127.0.0.1"}:
                self.send_error(403)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 <= length <= 65536:
                    self.send_error(413)
                    return
            except ValueError:
                self.send_error(400)
                return
            status, mime, content = handle(store, self.command, self.path, self.headers.get("Content-Type", ""),
                                          self.rfile.read(length), self.headers.get("Origin"), self.headers["Host"])
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)

        do_GET = request
        do_POST = request

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description="ACHA onboard demonstration server")
    cli.add_argument("--port", type=int, default=8765)
    args = cli.parse_args()
    with build_server(database(), args.port) as server:
        print(f"ACHA ready at http://127.0.0.1:{args.port}", flush=True)
        server.serve_forever()
