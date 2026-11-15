"""Summarize the two attributed public questionnaire score tables without participant records."""

from csv import DictReader
from hashlib import sha256
from io import StringIO
from json import dumps
from pathlib import Path
from statistics import median
from urllib.request import urlopen

BASE = "https://physionet.org/files/qol-stress/1.0.0/"
FILES = {"pss": "data/pss_14.csv", "stai": "data/stai.csv"}


def read(path: str) -> bytes:
    with urlopen(BASE + path, timeout=12) as response:
        payload = response.read(120_001)
    if len(payload) > 120_000:
        raise ValueError(f"Unexpected response size for {path}")
    return payload


def scores(data: bytes, phases: set[str], low: int, high: int) -> dict[str, dict[str, int]]:
    individuals: dict[str, dict[str, int]] = {}
    for row in DictReader(StringIO(data.decode("utf-8-sig"))):
        phase = row.get("phase", "all")
        person = individuals.setdefault(row["username"], {})
        score = int(row["score"])
        if phase not in phases or phase in person or not low <= score <= high:
            raise ValueError("Invalid or duplicate score")
        person[phase] = score
    if len(individuals) != 66 or any(person.keys() != phases for person in individuals.values()):
        raise ValueError("The score export does not contain the complete paired study cohort")
    return individuals


def summary(values: list[int]) -> dict:
    return {"count": len(values), "low": min(values), "median": median(values), "high": max(values)}


def main() -> None:
    manifest = {parts[1].lstrip("*./"): parts[0] for line in read("SHA256SUMS.txt").decode().splitlines()
                if len(parts := line.split()) == 2}
    inputs = {key: read(path) for key, path in FILES.items()}
    if any(sha256(inputs[key]).hexdigest() != manifest[path] for key, path in FILES.items()):
        raise ValueError("Archive checksum mismatch")
    pss = scores(inputs["pss"], {"all"}, 0, 56)
    stai = scores(inputs["stai"], {"relax", "stress"}, 20, 80)
    if pss.keys() != stai.keys():
        raise ValueError("Published questionnaire exports do not describe the same participants")
    output = {
        "pss": summary([person["all"] for person in pss.values()]),
        "relaxation": summary([person["relax"] for person in stai.values()]),
        "task": summary([person["stress"] for person in stai.values()]),
        "pairedChange": summary([person["stress"] - person["relax"] for person in stai.values()]),
        "sources": {path: manifest[path] for path in FILES.values()},
    }
    destination = Path(__file__).resolve().parents[1] / "frontend/src/data/qol-stress.json"
    destination.write_text(dumps(output, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
