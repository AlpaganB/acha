import assert from 'node:assert/strict'
import test from 'node:test'
import { missionScenarios, scenarioFrame } from '../src/missionScenarioData.ts'

test('lunar follow-up exposes the resting repeat without replacing the original or filling unsampled metrics', () => {
  const lunar = missionScenarios.find(scenario => scenario.id === 'lunar-fatigue')
  const checkIn = scenarioFrame(lunar, 2)
  const repeat = scenarioFrame(lunar, 3)
  assert.equal(checkIn.latest.values[1], 83)
  assert.deepEqual(repeat.latest.values, [null, 72, null])
  assert.ok(repeat.readings.includes(checkIn.latest))
  assert.equal(repeat.complete, false)
})

test('orbital replay computes pressure coverage and recovery only from telemetry visible at each checkpoint', () => {
  const orbit = missionScenarios.find(scenario => scenario.id === 'orbital-pressure')
  const gap = scenarioFrame(orbit, 3)
  assert.equal(gap.latest.values[0], null)
  assert.deepEqual(gap.pressure.transitions.map(item => item.change), [-5])
  assert.equal(gap.pressure.coveredMinutes, 160)
  const final = scenarioFrame(orbit, 6)
  assert.deepEqual(final.pressure.transitions.map(item => item.change), [-5, 5])
  assert.equal(final.pressure.coveredMinutes, 340)
  assert.equal(final.pressure.exposureMinutes, 30)
  assert.equal(final.complete, true)
})

test('solar event preserves original queue, send, and acknowledgment times across the simulated outage', () => {
  const solar = missionScenarios.find(scenario => scenario.id === 'solar-event')
  const offline = scenarioFrame(solar, 4)
  assert.equal(offline.relay.link, 'Unavailable')
  assert.equal(offline.relay.handover, 'Queued locally')
  assert.equal(offline.latest.values[1], null)
  assert.equal(offline.relay.sentAt, undefined)
  const online = scenarioFrame(solar, 5)
  assert.equal(online.relay.handover, 'Sent · awaiting receipt')
  assert.equal(online.relay.acknowledgedAt, undefined)
  const receipt = scenarioFrame(solar, 6)
  assert.deepEqual([receipt.relay.queuedAt, receipt.relay.sentAt, receipt.relay.acknowledgedAt], [1080, 2520, 3240])
})
