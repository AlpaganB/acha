"""Build the attributed, annotation-only Sleep-EDF research sample."""

import json
import re
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from itertools import pairwise
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

BASE = "https://physionet.org/files/sleep-edfx/1.0.0/"
HYPNOGRAM_PATH = re.compile(r"sleep-cassette/(SC4[0-9A-Z]{5})-Hypnogram\.edf")
TAL = re.compile(rb"\+(\d+)(?:\.0+)?\x15(\d+)(?:\.0+)?\x14(Sleep stage [W1234R?]|Movement time)\x14\x00")
STAGES = {b"Sleep stage " + stage: stage.decode() for stage in (b"W", b"1", b"2", b"3", b"4", b"R", b"?")}
STAGES[b"Movement time"] = "M"


def download(url: str, limit: int) -> bytes:
    with urlopen(url, timeout=15) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"Unexpected response size for {url}")
    return data


def parse_hypnogram(data: bytes) -> list[tuple[int, int, str]]:
    # This importer supports the archive's one-channel, one-record EDF+ annotation files.
    if (int(data[184:192]) != 512 or data[192:236].strip() != b"EDF+C"
            or int(data[236:244]) != 1 or int(data[252:256]) != 1
            or data[256:272].strip() != b"EDF Annotations" or len(data) != 512 + 2 * int(data[472:480])):
        raise ValueError("Unexpected EDF+ annotation header")
    segments = []
    for entry in data[512:].split(b"\x00"):
        if entry in {b"", b"+0\x14\x14"}:
            continue
        match = TAL.fullmatch(entry + b"\x00")
        if not match:
            raise ValueError(f"Unrecognized time-stamped annotation: {entry[:80]!r}")
        start, duration, label = match.groups()
        segments.append((int(start), int(duration), STAGES[label]))
    if not segments or any(start % 30 or duration <= 0 or duration % 30 for start, duration, _ in segments):
        raise ValueError("Unexpected sleep-scoring cadence")
    if any(start < previous + duration for (previous, duration, _), (start, _, _) in pairwise(segments)):
        raise ValueError("Overlapping sleep annotations")

    sleep = [index for index, (_, _, stage) in enumerate(segments) if stage in {"1", "2", "3", "4", "R"}]
    if not sleep:
        raise ValueError("No scored sleep annotation")
    window = segments[sleep[0]:sleep[-1] + 1]
    start_seconds = window[0][0]
    return [(start - start_seconds, duration, stage) for start, duration, stage in window]


def main() -> None:
    manifest = {
        parts[1].lstrip("*./"): parts[0]
        for line in download(BASE + "SHA256SUMS.txt", 80_000).decode().splitlines()
        if len(parts := line.split()) == 2
    }

    paths = [name for name in sorted(manifest) if HYPNOGRAM_PATH.fullmatch(name)]
    if len(paths) != 153:
        raise ValueError(f"Expected 153 Sleep Cassette hypnograms, found {len(paths)}")

    def fetch(path: str) -> dict:
        record_id = Path(path).name.split("-")[0]
        try:
            data = download(BASE + path, 30_000)
        except (HTTPError, TimeoutError):
            data = download(BASE + path, 30_000)
        checksum = sha256(data).hexdigest()
        if manifest.get(path) != checksum:
            raise ValueError(f"Archive checksum mismatch: {path}")
        try:
            segments = parse_hypnogram(data)
        except ValueError as exc:
            raise ValueError(f"Cannot parse {path}: {exc}") from exc
        return {"id": record_id, "participant": record_id[:5], "path": path, "sha256": checksum, "segments": segments}

    with ThreadPoolExecutor(max_workers=4) as executor:
        records = list(executor.map(fetch, paths))
    destination = Path(__file__).resolve().parents[1] / "frontend/src/data/sleep-edf.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("[\n" + ",\n".join(json.dumps(record, separators=(",", ":")) for record in records) + "\n]\n",
                           encoding="utf-8")
    print(f"Verified {len(records)} recordings from {len({record['participant'] for record in records})} participants.")


if __name__ == "__main__":
    main()
