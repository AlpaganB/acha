import assert from 'node:assert/strict'
import test from 'node:test'
import { missionScenarios, scenarioFrame } from '../src/missionScenarioData.ts'
import { scenarioEvents } from '../src/scenarioEvents.ts'
import { initialPlayback, playbackReducer } from '../src/scenarioPlayback.ts'

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

test('playback supports pause, seek, event inspection, route restoration, switch and replay', () => {
  let state = initialPlayback
  const act = action => (state = playbackReducer(state, action))
  const lunar = missionScenarios[0]
  const open = { type: 'open', id: lunar.id, play: true }
  assert.equal(act(open).selectedSystem, 'recovery')
  assert.equal(act({ type: 'tick' }).frameIndex, 1)
  act({ type: 'pause' })
  assert.equal(act({ type: 'tick' }).frameIndex, 1)
  act({ type: 'seek', index: 4 })
  const event = scenarioEvents(lunar, scenarioFrame(lunar, 4)).find(item => item.eventType === 'pulse-review')
  assert.equal(act({ type: 'inspect', event }).frameIndex, 2)
  assert.equal(state.selectedMetric, 1)
  assert.equal(act({ type: 'dismiss' }).frameIndex, 4)
  assert.equal(state.selectedMetric, 0)
  assert.equal(act({ type: 'seek', index: 5 }).frameIndex, 5)
  act({ type: 'toggle' })
  assert.equal(act({ type: 'tick' }).playing, false)
  assert.equal(state.frameIndex, 6)
  assert.equal(act({ type: 'toggle' }).frameIndex, 0)
  act({ type: 'tick' })
  assert.equal(act({ ...open, restore: true }).frameIndex, 1)
  assert.equal(state.playing, false)
  assert.equal(act({ type: 'open', id: 'solar-event' }).frameIndex, 0)
  assert.equal(act({ type: 'exit' }).mode, 'recorded')
})

test('review events use observed values and stable IDs, and disappear when the cursor rewinds', () => {
  const [lunar, pressure, solar] = missionScenarios
  const eventsAt = (scenario, step) => scenarioEvents(scenario, scenarioFrame(scenario, step))
  assert.deepEqual(eventsAt(lunar, 0), [])
  const pulse = eventsAt(lunar, 2).find(event => event.eventType === 'pulse-review')
  assert.deepEqual([pulse.currentValue, pulse.reference, pulse.delta, pulse.severity, pulse.observedAt], [83, 66, 17, 'Review', 2880])
  assert.match(pulse.comparisonContext, /provisional; activity\/posture unavailable/)
  assert.equal(eventsAt(lunar, 6).filter(event => event.id === pulse.id).length, 1)
  assert.equal(eventsAt(lunar, 1).some(event => event.id === pulse.id), false)
  const orbital = eventsAt(pressure, 5)
  assert.equal(orbital.find(event => event.eventType === 'pressure-gap').currentValue, null)
  assert.match(orbital.find(event => event.eventType === 'exercise-overlap').comparisonContext, /attribution uncertain/)
  assert.equal(orbital.find(event => event.eventType === 'pressure-recovery').delta, 5)
  const radiation = eventsAt(solar, 4)
  assert.equal(radiation.find(event => event.eventType === 'vehicle-monitor').unit, 'µGy/h')
  assert.equal(radiation.find(event => event.eventType === 'dosimeter-gap').unit, 'µGy')
  assert.equal(radiation.some(event => event.eventType === 'relay-sent'), false)
})
