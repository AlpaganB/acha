import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { reviewRadiation, reviewSleepLogs, reviewSleepStages } from '../src/monitoringAnalysis.ts'

const stamp = (day, hour = 8) => new Date(Date.UTC(2026, 10, day, hour)).toISOString()
const sleep = (day, hours, at = 8) => ({ kind: 'sleep_duration', value: hours, recorded_at: stamp(day, at) })

test('sleep requires five disjoint reference windows and exposes missing or conflicting days', () => {
  const records = [sleep(6, 7), sleep(7, 8), sleep(8, 7), sleep(9, 9), sleep(9, 6),
    sleep(10, 8), sleep(12, 8), sleep(14, 10, 9), sleep(15, 6)]
  const report = reviewSleepLogs(records, 14, Date.parse(stamp(15, 12)))
  assert.equal(report.reference, 8)
  assert.equal(report.baselineCount, 5)
  assert.equal(report.difference, -2)
  assert.deepEqual(report.ambiguousDays, ['2026-11-09'])
  assert.equal(report.daily.find(item => item.day === '2026-11-11').hours, null)
})

test('observed wake and unscored time remain distinct', () => {
  const result = reviewSleepStages([[0, 60, '1'], [60, 30, 'W'], [90, 60, 'W'], [180, 30, 'M'], [210, 60, 'R']])
  assert.deepEqual([result.sleepSeconds, result.wakeSeconds, result.longestWakeSeconds, result.unknownSeconds], [120, 90, 90, 60])
})

test('bundled annotations cover 153 distinct recordings with supported labels and valid timing', async () => {
  const records = JSON.parse(await readFile(new URL('../src/data/sleep-edf.json', import.meta.url), 'utf8'))
  assert.equal(records.length, 153)
  assert.equal(new Set(records.map(record => record.participant)).size, 78)
  assert.equal(new Set(records.map(record => record.id)).size, records.length)
  for (const record of records) {
    assert.match(record.sha256, /^[a-f0-9]{64}$/)
    let previousEnd = 0
    for (const [start, duration, stage] of record.segments) {
      assert.ok(start >= previousEnd && start % 30 === 0 && duration > 0 && duration % 30 === 0)
      assert.match(stage, /^[W1234RM?]$/)
      previousEnd = start + duration
    }
    const report = reviewSleepStages(record.segments)
    assert.ok(report.sleepSeconds > 0 && report.unknownSeconds >= 0)
  }
})

test('radiation replay reports no crossing without an input boundary and stops at gaps', () => {
  const p = (time, value) => ({ timestamp: `2022-04-01T00:${time}:00`, absorbed_dose_rate: value })
  const input = [p('00', 6), p('02', 8), p('08', 9), p('09', null), p('10', 7), p('11', 6), p('12', 5), p('14', 7)]
  assert.equal(reviewRadiation(input, null).events.length, 0)
  const report = reviewRadiation(input, 5)
  assert.equal(report.events.length, 2)
  assert.deepEqual(report.events.map(({ samples, peak }) => [samples, peak]), [[2, 8], [2, 7]])
  assert.equal(report.coveredSeconds, 360)
  assert.equal(report.gapCount, 3)
  assert.equal(report.missing, 1)
})
