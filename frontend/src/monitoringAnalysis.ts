import type { Measurement } from './api'
import { median } from './observationAnalysis.ts'

const hour = 3_600_000

export function reviewSleepLogs(measurements: Pick<Measurement, 'kind' | 'recorded_at' | 'value'>[], days = 14, now = Date.now()) {
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const from = today.getTime() - (days - 1) * 24 * hour
  const buckets = new Map<string, typeof measurements>()
  for (const record of measurements) {
    const time = Date.parse(record.recorded_at)
    if (record.kind !== 'sleep_duration' || time < from || time > now || !Number.isFinite(time)
      || !Number.isFinite(record.value) || record.value < 0 || record.value > 24) continue
    const day = new Date(time).toISOString().slice(0, 10)
    const bucket = buckets.get(day) ?? []
    bucket.push(record)
    buckets.set(day, bucket)
  }
  const ambiguousDays = [...buckets].filter(([, records]) => new Set(records.map(record => record.value)).size > 1)
    .map(([day]) => day).sort()
  const daysWithConflicts = new Set(ambiguousDays)
  const usable = [...buckets].filter(([day]) => !daysWithConflicts.has(day))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, records]) => ({ day, hours: records[0].value,
      latestTimestamp: Math.max(...records.map(record => Date.parse(record.recorded_at))),
      earliestTimestamp: Math.min(...records.map(record => Date.parse(record.recorded_at))),
    }))
  const latest = usable.at(-1)
  // Use earlier non-overlapping 24-hour reports to form a descriptive personal reference.
  const earlier = []
  let nextWindowEnd = latest?.earliestTimestamp ?? 0
  for (const item of usable.slice(0, -1).reverse()) {
    if (nextWindowEnd - item.latestTimestamp < 24 * hour) continue
    earlier.push(item)
    nextWindowEnd = item.earliestTimestamp
  }
  const reference = earlier.length >= 5 ? median(earlier.map(record => record.hours)) : null
  const byDay = new Map(usable.map(item => [item.day, item.hours]))
  const daily = Array.from({ length: days }, (_, index) => {
    const day = new Date(from + index * 24 * hour).toISOString().slice(0, 10)
    return { day, hours: byDay.get(day) ?? null, conflicting: daysWithConflicts.has(day) }
  })
  return { daily, ambiguousDays, usable, latest, reference, baselineCount: earlier.length,
    difference: latest && reference !== null ? latest.hours - reference : null }
}

export function sleepShortfall(report: ReturnType<typeof reviewSleepLogs>, target: number) {
  if (!Number.isFinite(target) || target <= 0 || target > 24) return null
  const dates = report.daily.slice(-7)
  if (dates.length !== 7 || dates.some(item => item.hours === null)) return null
  const week = report.usable.slice(-7)
  if (week.some((item, index) => index > 0 && item.earliestTimestamp - week[index - 1].latestTimestamp < 24 * hour)) return null
  return week.reduce((sum, item) => sum + Math.max(0, target - item.hours), 0)
}

export type SleepSegment = readonly [startSeconds: number, durationSeconds: number, stage: string]

export function reviewSleepStages(segments: readonly SleepSegment[]) {
  const periodSeconds = segments.reduce((end, [start, duration]) => Math.max(end, start + duration), 0)
  const stageSeconds: Record<string, number> = { W: 0, '1': 0, '2': 0, '3': 0, '4': 0, R: 0 }
  for (const [, duration, stage] of segments) {
    if (Object.hasOwn(stageSeconds, stage)) stageSeconds[stage] += duration
  }
  const wakeSeconds = stageSeconds.W
  const sleepSeconds = stageSeconds['1'] + stageSeconds['2'] + stageSeconds['3'] + stageSeconds['4'] + stageSeconds.R
  let longestWakeSeconds = 0
  let wakeRun = 0
  let lastEnd = 0
  for (const [start, duration, stage] of segments) {
    wakeRun = stage === 'W' ? (start === lastEnd ? wakeRun : 0) + duration : 0
    longestWakeSeconds = Math.max(longestWakeSeconds, wakeRun)
    lastEnd = start + duration
  }
  return { periodSeconds, stageSeconds, sleepSeconds, wakeSeconds, longestWakeSeconds,
    unknownSeconds: periodSeconds - sleepSeconds - wakeSeconds }
}

export type RadiationPoint = { timestamp: string; absorbed_dose_rate: number | null }
type ReviewEvent = { start: string; end: string; samples: number; peak: number }
const maxIntervalSeconds = 300
// Offset-free archive labels are mapped onto a fixed numeric axis for elapsed-time arithmetic only.
export const radiationTime = (stamp: string) => Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ? stamp : `${stamp}Z`) / 1000

export function reviewRadiation(samples: readonly RadiationPoint[], boundary: number | null) {
  const valid = (point: RadiationPoint | undefined): point is RadiationPoint & { absorbed_dose_rate: number } =>
    point?.absorbed_dose_rate != null && Number.isFinite(point.absorbed_dose_rate) && point.absorbed_dose_rate >= 0
  const ordered = [...samples].filter(point => Number.isFinite(radiationTime(point.timestamp)))
    .sort((left, right) => radiationTime(left.timestamp) - radiationTime(right.timestamp))
  const points = ordered.filter(valid)
  const max = points.reduce<number | null>((highest, point) => Math.max(highest ?? 0, point.absorbed_dose_rate), null)
  const events: ReviewEvent[] = []
  let run: ReviewEvent | undefined
  let coveredSeconds = 0
  let gapCount = 0
  for (const [index, point] of ordered.entries()) {
    const previous = ordered[index - 1]
    const elapsed = previous ? radiationTime(point.timestamp) - radiationTime(previous.timestamp) : 0
    const connected = Boolean(previous && elapsed > 0 && elapsed <= maxIntervalSeconds && valid(previous) && valid(point))
    if (connected) coveredSeconds += elapsed
    else if (previous) gapCount++
    const over = boundary !== null && Number.isFinite(boundary) && boundary > 0 && valid(point) && point.absorbed_dose_rate > boundary
    if (run && (!connected || !over)) {
      if (run.samples >= 2) events.push(run)
      run = undefined
    }
    if (!over) continue
    run = run ? { ...run, end: point.timestamp, samples: run.samples + 1, peak: Math.max(run.peak, point.absorbed_dose_rate) }
      : { start: point.timestamp, end: point.timestamp, samples: 1, peak: point.absorbed_dose_rate }
  }
  if (run && run.samples >= 2) events.push(run)
  return { points, max, coveredSeconds, gapCount, missing: samples.length - points.length, events }
}
