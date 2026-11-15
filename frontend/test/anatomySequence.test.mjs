import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceStage, initialStage, phaseDuration, selectStage } from '../src/anatomySequence.ts'

test('every system returns through a full-body view before focusing on the next', () => {
  let stage = initialStage(true)
  assert.equal(stage.phase, 'intro')
  stage = advanceStage(stage)
  assert.deepEqual([stage.phase, stage.index], ['in', 1])
  stage = advanceStage(stage)
  for (const target of [2, 3, 1]) {
    assert.equal(stage.phase, 'hold')
    assert.equal(phaseDuration[stage.phase], 4000)
    for (const phase of ['out', 'wide', 'in', 'hold']) {
      stage = advanceStage(stage)
      assert.equal(stage.phase, phase)
    }
    assert.equal(stage.index, target)
  }
})
test('manual selection keeps the skeleton bridge and permits transitions while paused', () => {
  let stage = selectStage(initialStage(false), 3, false)
  assert.equal(stage.phase, 'out')
  assert.equal(stage.manual, true)
  stage = selectStage(stage, 2, false)
  assert.equal(stage.phase, 'out')
  stage = advanceStage(advanceStage(advanceStage(stage)))
  assert.deepEqual([stage.phase, stage.index, stage.manual], ['hold', 2, false])
})
test('reduced motion selection goes directly to the requested system', () => {
  const stage = selectStage(initialStage(true), 3, true)
  assert.deepEqual([stage.phase, stage.index, stage.manual], ['hold', 3, false])
  assert.equal(selectStage(stage, 9, false), stage)
  assert.equal(selectStage(stage, 3, false), stage)
})

test('both anatomy crossfades use the same controlled 600–800 ms timing', () => {
  assert.ok(phaseDuration.out >= 600 && phaseDuration.out <= 800)
  assert.equal(phaseDuration.in, phaseDuration.out)
})
