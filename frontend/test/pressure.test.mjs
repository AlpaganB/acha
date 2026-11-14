import assert from 'node:assert/strict'
import test from 'node:test'
import { compareResponse, pressureScenario, summarizePressure } from '../src/pressureAnalysis.ts'

test('pressure transitions and coverage use consecutive same-direction intervals', () => {
  const { transitions, coveredMinutes, exposureMinutes } = summarizePressure(pressureScenario.samples)
  assert.equal(pressureScenario.provenance, 'SYNTHETIC')
  assert.equal(pressureScenario.samples.length, 73)
  assert.deepEqual(transitions.map(({ direction, change, minutes, fastestStep }) =>
    [direction, change, minutes, fastestStep]), [['Decrease', -5, 15, -0.33], ['Increase', 5, 15, 0.33]])
  assert.equal(coveredMinutes, 340)
  assert.equal(exposureMinutes, 30)
})

test('a telemetry gap contributes neither a rate nor exposure time', () => {
  const sample = pressureScenario.samples[0]
  const series = [
    { ...sample, at: '2026-11-15T08:00:00.000Z', pressure: 80 },
    { ...sample, at: '2026-11-15T08:10:00.000Z', pressure: 90 },
    { ...sample, at: '2026-11-15T08:15:00.000Z', pressure: null },
    { ...sample, at: '2026-11-15T08:20:00.000Z', pressure: 80 },
  ]
  assert.deepEqual(summarizePressure(series), { transitions: [], coveredMinutes: 0, exposureMinutes: 0 })
})

test('crew response reports sample counts, missingness, exercise, and symptoms', () => {
  const { samples } = pressureScenario
  const [decrease] = summarizePressure(samples).transitions
  const response = compareResponse(samples, decrease)
  assert.equal(response.exercise, true)
  assert.deepEqual(response.symptoms.map(({ label }) => label), ['Ear fullness'])
  assert.deepEqual(response.metrics.map(({ key, baselineCount, afterCount }) =>
    [key, baselineCount, afterCount]), [['heartRate', 24, 4], ['spo2', 24, 3], ['respiratoryRate', 24, 3]])
  const limited = compareResponse(samples.filter((sample, index) => !sample.baseline || index < 4), decrease)
  assert.ok(limited.metrics.every(metric => metric.reference === null && metric.difference === null))
})
