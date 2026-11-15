"""Bounded sender for a device process with an intermittent link."""

from collections import deque
from http.client import IncompleteRead
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pydantic import TypeAdapter

from .schemas import Code
from .telemetry import DeviceSample, Receipt


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class DeviceUploadQueue:
    def __init__(self, api_url: str, mission: str, channel: str, token: str, *, capacity: int = 1000):
        endpoint = urlsplit(api_url)
        is_loopback = endpoint.hostname in {"localhost", "127.0.0.1", "::1"}
        if (not endpoint.hostname or endpoint.username is not None or endpoint.password is not None
                or endpoint.path.rstrip("/") != "/api/v1" or endpoint.query or endpoint.fragment
                or api_url.rstrip("/") != endpoint.geturl().rstrip("/")
                or (endpoint.scheme != "https" and not (is_loopback and endpoint.scheme == "http"))):
            raise ValueError("Use the restricted HTTPS API URL ending in /api/v1.")
        if capacity < 1:
            raise ValueError("Queue capacity must be positive.")
        code = TypeAdapter(Code)
        mission, channel = code.validate_python(mission), code.validate_python(channel)
        self._url = f"{api_url.rstrip('/')}/observations/missions/{mission}/devices/{channel}/samples"
        self.replace_key(token)
        self._capacity = capacity
        self._opener = build_opener(NoRedirect())
        self._queue: deque[tuple[int, bytes]] = deque()

    @property
    def pending(self) -> int:
        return len(self._queue)

    def replace_key(self, token: str) -> None:
        if not 32 <= len(token) <= 256 or any(char.isspace() for char in token):
            raise ValueError("A valid device key is required.")
        self._token = token

    def enqueue(self, sample: DeviceSample) -> None:
        if self.pending >= self._capacity:
            raise BufferError("The device upload queue is full.")
        self._queue.append((sample.sequence, sample.model_dump_json().encode()))

    def flush(self) -> list[Receipt]:
        delivered = []
        while self._queue:
            sequence, body = self._queue[0]
            request = Request(self._url, data=body, method="POST", headers={
                "Authorization": f"Bearer {self._token}", "Content-Type": "application/json",
            })
            try:
                with self._opener.open(request, timeout=5) as response:
                    if response.status not in {200, 201}:
                        raise ValueError("Unexpected device intake status.")
                    receipt = Receipt.model_validate_json(response.read(2048))
                    if receipt.sequence != sequence:
                        raise ValueError("Device receipt refers to a different sample.")
            except HTTPError as error:
                error.close()
                if error.code < 500 and error.code not in {408, 429}:
                    raise RuntimeError(f"Device intake returned HTTP {error.code}. The sample is still queued.") from None
                break
            except (URLError, TimeoutError, ConnectionError, IncompleteRead):
                break
            self._queue.popleft()
            delivered.append(receipt)
        return delivered
