import type { MissionObservation } from './api'

export type NumericObservation = MissionObservation & { value: number }

const numericRange = (readings: number[]) => [Math.min(...readings), Math.max(...readings)] as const

export function median(numbers: number[]) {
  if (!numbers.length) return null
  const values = [...numbers].sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
}

function sameContext(a: MissionObservation, b: MissionObservation) {
  return a.mission_code === b.mission_code && a.location === b.location
    && (a.provenance === 'SYNTHETIC') === (b.provenance === 'SYNTHETIC')
}

function comparisonContext(record: MissionObservation) {
  const context = record.context
  switch (context?.kind) {
    case 'reading':
      return [context.kind, context.posture, context.timing]
    case 'sleep_episode':
      return [context.kind, context.method, context.shift, context.utc_offset_minutes, context.illuminance_lux, context.workload]
    case 'performance':
      return [context.kind, context.protocol, context.version, context.trials, context.shift, context.utc_offset_minutes,
        context.illuminance_lux, context.workload]
    case 'protocol':
      return [context.kind, context.protocol, context.version, context.body_site, context.source_ref]
    case 'radiation':
      return [context.kind, context.source_ref, context.geometry_ref, context.shielding_ref, context.particle_class]
    case 'dose_estimate':
      return [context.kind, context.source_ref, context.model_version, context.tissue]
    default:
      return []
  }
}

export function comparableTo(a: MissionObservation, b: MissionObservation) {
  return sameContext(a, b) && a.crew_code === b.crew_code && a.unit === b.unit && a.device === b.device
    && a.calibration === b.calibration && a.provenance === b.provenance && a.method === b.method
    && JSON.stringify(comparisonContext(a)) === JSON.stringify(comparisonContext(b))
}

export function usableSeries(records: MissionObservation[], key: string) {
  const buckets = new Map<string, NumericObservation[]>()
  for (const record of records) {
    if (record.parameter !== key || record.quality !== 'verified' || record.value === null) continue
    const id = JSON.stringify([record.mission_code, record.location, record.crew_code, record.phase,
      record.provenance, record.device, record.calibration, comparisonContext(record), Date.parse(record.recorded_at)])
    const group = buckets.get(id) ?? []
    group.push({ ...record, value: record.value })
    buckets.set(id, group)
  }
  const series = [...buckets.values()].flatMap(([record, ...duplicates]) => duplicates.every(candidate =>
    candidate.value === record.value && candidate.activity === record.activity && candidate.unit === record.unit
    && candidate.device === record.device && candidate.calibration === record.calibration
    && candidate.uncertainty === record.uncertainty) ? [record] : [])
  return series.sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
}

export function priorBaseline(series: NumericObservation[]) {
  const latest = series.at(-1)
  if (!latest) return { value: null, count: 0, delta: null }
  const end = Date.parse(latest.recorded_at)
  const prior = series.filter(item => {
    const age = end - Date.parse(item.recorded_at)
    return age > 0 && age <= 30 * 86_400_000 && comparableTo(item, latest)
      && item.phase === latest.phase && item.activity === latest.activity
  })
  const value = prior.length >= 5 ? median(prior.map(item => item.value)) : null
  return { value, count: prior.length, delta: value === null ? null : latest.value - value }
}

export function phaseSummary(series: NumericObservation[]) {
  const comparable = series.at(-1)
  return ['preflight', 'in_flight', 'eva', 'postflight'].map(phase => {
    const values = series.filter(item => item.phase === phase && comparable && comparableTo(item, comparable)
      && item.activity === comparable.activity)
      .map(item => item.value)
    return { phase, count: values.length, median: median(values) }
  })
}

export function compareSeries(first: NumericObservation[], second: NumericObservation[], minutes: number) {
  const used = new Set<number>()
  const pairs: { left: NumericObservation; right: NumericObservation; lag: number }[] = []
  for (const left of first) {
    let closest = -1
    let best = Infinity
    for (const [index, right] of second.entries()) {
      if (used.has(index) || !sameContext(left, right) || left.phase !== right.phase
        || (left.crew_code && right.crew_code && left.crew_code !== right.crew_code)) continue
      const lag = (Date.parse(right.recorded_at) - Date.parse(left.recorded_at)) / 60_000
      if (lag < 0 || lag > minutes || lag >= best) continue
      closest = index
      best = lag
    }
    if (closest >= 0) {
      used.add(closest)
      pairs.push({ left, right: second[closest], lag: best })
    }
  }
  if (pairs.length < 5) return { pairs, correlation: null }
  const xs = pairs.map(pair => pair.left.value)
  const ys = pairs.map(pair => pair.right.value)
  const [minX, maxX] = numericRange(xs)
  const [minY, maxY] = numericRange(ys)
  if (minX === maxX || minY === maxY) return { pairs, correlation: null }
  const midX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const midY = ys.reduce((sum, value) => sum + value, 0) / ys.length
  const sumX = xs.reduce((sum, value) => sum + (value - midX) ** 2, 0)
  const sumY = ys.reduce((sum, value) => sum + (value - midY) ** 2, 0)
  const covariance = xs.reduce((sum, value, index) => sum + (value - midX) * (ys[index] - midY), 0)
  return { pairs, correlation: Math.max(-1, Math.min(1, covariance / Math.sqrt(sumX * sumY))) }
}

export function pressureIntervals(series: NumericObservation[]) {
  return series.flatMap((current, index) => {
    const previous = series[index - 1]
    if (!previous || !comparableTo(current, previous) || previous.phase !== current.phase) return []
    const minutes = (Date.parse(current.recorded_at) - Date.parse(previous.recorded_at)) / 60_000
    if (minutes <= 0 || minutes > 5) return []
    return [{ start: previous.recorded_at, end: current.recorded_at, minutes, initial: previous.value, final: current.value,
      change: current.value - previous.value,
      rate: (current.value - previous.value) / minutes }]
  })
}
