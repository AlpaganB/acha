from fastapi import FastAPI, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from crew_app import database
from serve_demo import handle, json_response

app = FastAPI(title="ACHA onboard demo")
store = database()


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def onboard(request: Request, path: str):
    host = request.headers.get("host", "")
    if host.split(":")[0] not in {"127.0.0.1", "localhost"}:
        status, mime, content = json_response(403, {"error": "Use the onboard loopback address."})
    else:
        body = await request.body()
        if len(body) > 65536:
            status, mime, content = json_response(413, {"error": "Request is too large."})
        else:
            status, mime, content = await run_in_threadpool(
                handle, store, request.method, "/" + path,
                request.headers.get("content-type", ""), body, request.headers.get("origin"), host)
    return Response(content, status_code=status, media_type=mime)
