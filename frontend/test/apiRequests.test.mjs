import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', '({})')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { api, observationsApi, ApiError } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
let calls
function capture(response = {}) {
  calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(response), { status: 200 }) }
}
test('crew and mission profile creation preserve the backend payload', async () => {
  capture()
  const crew = { display_name: 'Example crew', mission_profile_id: 'profile-id' }
  const profile = { name: 'Example mission', environment: 'orbital_station', equipment: ['Oximeter'], constraints: [], guidance_protocol_ids: ['example'], measurement_schedules: [{ kind: 'spo2', interval_minutes: 60 }] }
  await api.createCrew(crew); await api.createProfile(profile)
  assert.deepEqual(calls.map(call => [call.url, call.options.method, JSON.parse(call.options.body)]), [
    ['/api/v1/crew-members', 'POST', crew], ['/api/v1/mission-profiles', 'POST', profile],
  ])
})
test('detail screens request records scoped to the selected crew', async () => {
  capture(); const signal = new AbortController().signal
  await api.crewMember('crew-id', signal); await api.profile('profile-id', signal); await api.measurement('crew-id', 'reading-id', signal)
  assert.deepEqual(calls.map(call => call.url), ['/api/v1/crew-members/crew-id', '/api/v1/mission-profiles/profile-id', '/api/v1/crew-members/crew-id/measurements/reading-id'])
  assert.ok(calls.every(call => call.options.signal instanceof AbortSignal && call.options.cache === 'no-store'))
})
test('external assessment result uses PUT and the existing assessment identity', async () => {
  capture(); const result = { status: 'review', rationale: 'Imported result', next_step: 'Recheck', protocol_id: null }
  await api.storeAssessmentResult('crew-id', 'assessment-id', result)
  assert.equal(calls[0].url, '/api/v1/crew-members/crew-id/assessments/assessment-id/result')
  assert.equal(calls[0].options.method, 'PUT'); assert.deepEqual(JSON.parse(calls[0].options.body), result)
})
test('device ingestion sends its own device key and preserves sequence metadata', async () => {
  capture({ sequence: 15, status: 'accepted', observation_id: 'sample-id' })
  const sample = { sequence: 15, recorded_at: '2026-11-15T10:00:00Z', mission_elapsed_ms: 60000, clock_error_ms: 10, firmware: 'v1', quality: 'ok', value: 72, uncertainty: null, activity: 'rest' }
  const receipt = await observationsApi.ingestSample('example-test-device-key', 'mission-a', 'channel-a', sample, new AbortController().signal)
  assert.equal(calls[0].url, '/api/v1/observations/missions/mission-a/devices/channel-a/samples')
  assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer example-test-device-key')
  assert.equal(calls[0].options.method, 'POST'); assert.deepEqual(JSON.parse(calls[0].options.body), sample)
  assert.equal(receipt.status, 'accepted')
})
test('validation and conflict responses surface actionable backend errors', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: [{ msg: 'Clock must match the mission.' }] }), { status: 422 })
  await assert.rejects(api.createCrew({ display_name: '', mission_profile_id: '' }), reason => reason instanceof ApiError && reason.status === 422 && /Clock must match/.test(reason.message))
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'A different assessment result is already stored.' }), { status: 409 })
  await assert.rejects(api.storeAssessmentResult('crew', 'id', {}), reason => reason.status === 409 && /already stored/.test(reason.message))
})
