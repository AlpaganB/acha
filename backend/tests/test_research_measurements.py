from io import StringIO

import pytest

from app import research_measurements as research


@pytest.fixture(autouse=True)
def clear_archives():
    research.bidmc_signals.cache_clear()
    research.assay_coverage.cache_clear()
    yield
    research.bidmc_signals.cache_clear()
    research.assay_coverage.cache_clear()


def test_waveform_index_keeps_published_rounding_and_individual_gaps(client, monkeypatch):
    def source(url, limit):
        assert url == research.SIGNALS and limit == 3_000_000
        rows = ["Time [s], RESP, PLETH, V, AVR, II"]
        for index in range(60_001):
            timestamp = f"{index / 125:.2f}" if index >= 12_500 else f"{index / 125:.3f}"
            ecg = "NaN" if index == 59_375 else "3"
            rows.append(f"{timestamp},1,2,0,0,{ecg}")
        return StringIO("\n".join(rows))

    monkeypatch.setattr(research, "csv_text", source)
    response = client.get("research/bidmc-01-waveforms?start=475")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["sample_rate_hz"] == 125 and data["start_seconds"] == 475
    ecg, pleth, resp = data["channels"]
    assert (ecg["unit"], pleth["unit"], resp["unit"]) == ("mV", "NU", "pm")
    assert len(ecg["values"]) == len(pleth["values"]) == len(resp["values"]) == 625
    assert ecg["values"][:2] == [None, 3.0]
    assert client.get("research/bidmc-01-waveforms?start=476").status_code == 422


def test_lab_coverage_uses_published_columns_without_sample_ids(client, monkeypatch):
    source = StringIO("Sample Name,il6_concentration_npq,,il6_percent_normalized_value\n"
                      "private-code-a,12,,NA\nprivate-code-b,ND,,98\n")
    monkeypatch.setattr(research, "csv_text", lambda *args: source)
    response = client.get("research/osdr-assays/OSD-656")
    assert response.status_code == 200, response.text
    assert "private-code" not in response.text
    assert response.json()["fields"] == [
        {"name": "IL6", "unit": "NPQ", "numeric_rows": 1, "other_rows": 1},
        {"name": "IL6", "unit": "%", "numeric_rows": 1, "other_rows": 1},
    ]
