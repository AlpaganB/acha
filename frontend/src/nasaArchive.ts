import { ApiError } from './api'

export const rr6Source = 'https://osdr.nasa.gov/bio/repo/data/payloads/RR-6'
export const dosTelSource = 'https://visualization.osdr.nasa.gov/radlab/gui/knowledgebase/dostel1'

export function rr6SourceExport(window: 'day' | 'week') {
  const query = new URLSearchParams({ start: '2017-12-15T00:00:00Z',
    end: `2017-12-${window === 'day' ? '16' : '22'}T00:00:00Z`, format: 'json' })
  return `https://visualization.osdr.nasa.gov/eda/api/missions/RR-6/telemetry_data/?${query}`
}

export function dosTelSourceExport(window: 'sample' | 'day') {
  const [start, end] = window === 'sample' ? ['23%3A00', '01%3A05'] : ['00%3A00', '00%3A00']
  return 'https://visualization.osdr.nasa.gov/radlab/api/?instrument_id=DosTel1' +
    `&timestamp%3E=2022-04-01T${start}&timestamp%3C2022-04-02T${end}&absorbed_dose_rate&dose_equivalent_rate&format=csv`
}

export function archiveError(error: unknown, name: 'RR-6' | 'DosTel1') {
  if (!(error instanceof ApiError)) return `The ${name} archive could not be opened.`
  if (error.status === 404) return `The mission service does not expose the ${name} archive (HTTP 404).`
  if (error.status === 502 || error.status === 504) return `The mission service could not load the ${name} archive (HTTP ${error.status}).`
  if (error.status === 0) return `The mission service could not be reached for the ${name} archive.`
  return `The ${name} archive request failed (HTTP ${error.status}).`
}
