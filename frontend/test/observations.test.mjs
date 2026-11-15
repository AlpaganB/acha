import assert from 'node:assert/strict'
import test from 'node:test'
import { compareSeries, phaseSummary, pressureIntervals, priorBaseline, usableSeries } from '../src/observationAnalysis.ts'

const at = minute => new Date(Date.UTC(2026, 10, 15, 9, minute)).toISOString()
const reading = (minute, value, overrides = {}) => ({
  id: `id-${minute}`, recorded_at: at(minute), value, parameter: 'heart_rate', crew_code: 'crew-a',
  location: 'habitat-a', mission_code: 'example', phase: 'in_flight', activity: 'rest',
  provenance: 'MANUAL_OBSERVATION', quality: 'verified', device: 'monitor-1', unit: 'bpm', ...overrides,
})

test('verified series collapses matching duplicates and excludes conflicts', () => {
  const items = [reading(0, 60), reading(0, 60), reading(5, 61), reading(5, 65), reading(10, 65, { quality: 'suspect' }),
    reading(15, null, { event_text: 'Example event' })]
  assert.deepEqual(usableSeries(items, 'heart_rate').map(item => item.value), [60])
})

test('baseline and phase summaries require comparable subject, device, and context', () => {
  const items = Array.from({ length: 6 }, (_, index) => reading(index * 5, 62 + index))
  const history = [reading(-20, 61, { phase: 'preflight' }), reading(-15, 60, { device: 'different' }),
    reading(-10, 61, { crew_code: 'crew-b' }), reading(-5, 200, { provenance: 'SYNTHETIC' }), ...items]
  assert.deepEqual(priorBaseline(history), { value: 64, count: 5, delta: 3 })
  assert.deepEqual(phaseSummary(history).slice(0, 2), [
    { phase: 'preflight', count: 1, median: 61 }, { phase: 'in_flight', count: 6, median: 64.5 },
  ])
})

test('performance baselines start over on protocol, device or shift changes', () => {
  const conditions = { kind: 'performance', protocol: 'browser-reaction', version: 'v1', trials: 5,
    valid_trials: 5, shift: 'alpha', utc_offset_minutes: 0, illuminance_lux: 100, workload: 2 }
  const task = (minute, value, fields = {}, context = {}) => reading(minute, value, {
    parameter: 'reaction_time', unit: 'ms', method: 'protocol_transcribed', context: { ...conditions, ...context }, ...fields,
  })
  const history = [task(1, 100, {}, { version: 'v2' }), task(2, 100, {}, { shift: 'bravo' }),
    task(3, 100, { device: 'monitor-2' }), ...Array.from({ length: 6 }, (_, index) => task(index + 4, 200 + index))]
  assert.deepEqual(priorBaseline(usableSeries(history, 'reaction_time')), { value: 202, count: 5, delta: 3 })
})

test('pairing requires matching location, time and provenance class and never reuses an observation', () => {
  const first = [0, 2, 10, 15, 20, 25].map((minute, index) => reading(minute, index + 1, { crew_code: null }))
  const second = [1, 12, 17, 22, 27].map((minute, index) => reading(minute, [1, 3, 4, 5, 6][index], { parameter: 'spo2' }))
  const candidates = [reading(1, 120, { location: 'airlock' }), reading(2, 120, { provenance: 'SYNTHETIC' }), ...second]
  const result = compareSeries(first, candidates, 5)
  assert.equal(result.pairs.length, 5)
  assert.equal(new Set(result.pairs.map(pair => pair.right.id)).size, 5)
  assert.ok(result.correlation > 0.99)
  assert.equal(compareSeries(first, candidates, 1).correlation, null)
})

test('pressure derivatives do not bridge gaps, devices, or phases', () => {
  const series = [reading(0, 100), reading(2, 98), reading(15, 96), reading(16, 94, { device: 'other' }),
    reading(17, 93, { phase: 'eva' })]
  assert.deepEqual(pressureIntervals(series).map(item => [item.minutes, item.change, item.rate]), [[2, -2, -1]])
})
