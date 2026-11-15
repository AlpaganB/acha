import { median } from './observationAnalysis.ts'
import { pressureScenario, sampleMinutes, summarizePressure } from './pressureAnalysis.ts'

export interface ScenarioMetric {
  label: string
  unit: string
  range: readonly [number, number]
  reference?: number | null
}

interface Reading {
  minute: number
  values: readonly (number | null)[]
}

type RelayEvent = 'outage' | 'queue' | 'reconnect' | 'acknowledge'

interface Checkpoint {
  minute: number
  title: string
  status: string
  event: string
  system: string
  crew: string
  relay?: RelayEvent
}

interface MissionScenario {
  id: 'lunar-fatigue' | 'orbital-pressure' | 'solar-event'
  environment: string
  title: string
  duration: string
  subject: string
  intro: string
  topics: readonly string[]
  metrics: readonly ScenarioMetric[]
  readings: readonly Reading[]
  checkpoints: readonly Checkpoint[]
  outcome: string
  source: { label: string; url: string }
  related: { label: string; url: string }
}

const hour = 60
const day = 24 * hour
const lunarBaseline = {
  sleep: [7.5, 7.8, 7.6, 7.4, 7.7],
  heart: [64, 67, 66, 65, 68],
  reaction: [244, 251, 250, 247, 258],
}

const lunar: MissionScenario = {
  id: 'lunar-fatigue', environment: 'Lunar surface', title: 'Fatigue after a shift change', duration: '7 days', subject: 'Emirhan Caman · Habitat crew',
  intro: 'An early maintenance rotation interrupts Emirhan’s sleep. Follow the week from a personal reference through a check-in, a repeat reading, and recovery monitoring.',
  topics: ['Personal baseline', 'Sleep and performance', 'Assessment follow-up'],
  metrics: [
    { label: 'Sleep in previous 24 h', unit: 'h', range: [4, 9], reference: median(lunarBaseline.sleep) },
    { label: 'Heart rate', unit: 'bpm', range: [60, 90], reference: median(lunarBaseline.heart) },
    { label: 'Reaction time', unit: 'ms', range: [200, 380], reference: median(lunarBaseline.reaction) },
  ],
  readings: [
    { minute: 0, values: [7.6, 66, 250] },
    { minute: day, values: [6.2, 73, 285] },
    { minute: 2 * day, values: [5, 83, 328] },
    { minute: 2 * day + 30, values: [null, 72, null] },
    { minute: 3 * day, values: [6.6, 71, 285] },
    { minute: 5 * day, values: [7.5, 67, 257] },
    { minute: 7 * day, values: [7.7, 65, 251] },
  ],
  checkpoints: [
    { minute: 0, title: 'Set the reference', status: 'Baseline', event: 'Emirhan starts the week on the usual work schedule.',
      system: 'ACHA compares readings with the median of five earlier training sessions for this crew member.',
      crew: 'Logs sleep for the previous 24 hours, a resting pulse, and the result of the same reaction task.' },
    { minute: day, title: 'Early maintenance shift', status: 'Trend to review', event: 'The first early shift follows a shorter sleep period.',
      system: 'The sleep report falls below Emirhan’s reference and reaction time is longer. A single observation does not establish a trend.',
      crew: 'Adds the new shift and recent workload to the log so the readings can be interpreted in context.' },
    { minute: 2 * day, title: 'Fatigue check-in', status: 'Assessment opened', event: 'Emirhan reports fatigue after a second early shift.',
      system: 'The check-in brings together the symptom, sleep and pulse. The pulse has no posture or activity context, so its comparison is provisional.',
      crew: 'Links the recorded readings to the check-in and leaves it open for a repeat.' },
    { minute: 2 * day + 30, title: 'Repeat under known conditions', status: 'Follow-up linked', event: 'A repeat pulse is recorded at rest 30 minutes later.',
      system: 'The new reading is closer to Emirhan’s reference. The original remains attached to the assessment. There is no new sleep report or reaction test at this checkpoint.',
      crew: 'Links the repeat and records the measurement context. The follow-up stays open to review the next shifts.' },
    { minute: 3 * day, title: 'Review the next shift', status: 'Monitoring', event: 'After a schedule adjustment in the exercise, Emirhan logs a longer sleep period.',
      system: 'Sleep and reaction time move toward their reference values. The replay preserves both measurements and their timing.',
      crew: 'Records the schedule change and repeats the same reaction task for a comparable result.' },
    { minute: 5 * day, title: 'Confirm improvement', status: 'Monitoring', event: 'Two shifts later the measurements are closer to baseline.',
      system: 'ACHA shows the repeat observations beside the original departure rather than overwriting the early-shift values.',
      crew: 'Notes that fatigue has eased and waits for the final scheduled review.' },
    { minute: 7 * day, title: 'Close the training check-in', status: 'Follow-up closed', event: 'The final reports are close to Emirhan’s reference.',
      system: 'The replay closes the workflow with the initial assessment, linked repeat, and recovery observations in the timeline.',
      crew: 'Records the outcome and resumes routine monitoring in the exercise.' },
  ],
  outcome: 'The check-in preserves the original context and the repeat reading. The timeline shows improvement after the shift change without assigning a cause or a clinical score.',
  source: { label: 'NASA · Sleep and fatigue in spaceflight', url: 'https://www.nasa.gov/human-systems-integration-division/human-performance/fatigue-countermeasures-laboratory/' },
  related: { label: 'Open sleep monitoring', url: '/mission/monitoring' },
}

const pressure: MissionScenario = {
  id: 'orbital-pressure', environment: 'Low Earth orbit', title: 'Cabin pressure excursion', duration: '6 hours', subject: `${pressureScenario.subject} · ${pressureScenario.location}`,
  intro: 'Cabin pressure drops during an orbital shift. Follow a telemetry gap, exercise context, and a recovery check in the same dataset used by ACHA’s cabin pressure review.',
  topics: ['Cabin telemetry', 'Data quality', 'Crew response'],
  metrics: [
    { label: 'Cabin pressure', unit: 'kPa', range: [94, 104] },
    { label: 'Heart rate', unit: 'bpm', range: [60, 85] },
    { label: 'Blood oxygen saturation', unit: '%', range: [95, 100] },
    { label: 'Respiratory rate', unit: 'breaths/min', range: [12, 21] },
  ],
  readings: pressureScenario.samples.map((sample, index) => ({ minute: index * sampleMinutes,
    values: [sample.pressure, sample.heartRate, sample.spo2, sample.respiratoryRate] })),
  checkpoints: [
    { minute: 0, title: 'Start the shift', status: 'Baseline', event: 'Cabin pressure is stable at the beginning of the exercise.',
      system: 'ACHA collects five-minute instrument samples alongside crew measurements and activity context.',
      crew: 'Marks the initial crew readings as resting measurements.' },
    { minute: 120, title: 'Establish resting context', status: 'Reference ready', event: 'Two hours of readings are available before the pressure change.',
      system: 'Only the readings marked as resting baseline are eligible for the pressure response comparison.',
      crew: 'Records the baseline period separately from the planned exercise block.' },
    { minute: 155, title: 'Detect a pressure drop', status: 'Transition detected', event: 'Successive samples show a drop from 101.3 to 96.3 kPa in 15 minutes.',
      system: 'The pressure analysis groups adjacent decreases into one transition and calculates the observed change and rate.',
      crew: 'Records that exercise began during the pressure drop, which affects how the pulse is interpreted.' },
    { minute: 170, title: 'Identify missing telemetry', status: 'Data gap', event: 'The pressure channel stops reporting. The crew has reported ear fullness.',
      system: 'Missing intervals are excluded from pressure coverage and time below the exercise’s analysis boundary. Other channels retain their own availability.',
      crew: 'Keeps the symptom report and activity context in the log. A missing reading is not recorded as zero.' },
    { minute: 185, title: 'Review resumed readings', status: 'Context review', event: 'Pressure telemetry resumes and the crew logs a mild headache.',
      system: 'The chart resumes after the gap. The elevated pulse overlaps with exercise, so the replay does not attribute it to the pressure change.',
      crew: 'Records the symptom time and the end of exercise to support a resting comparison later.' },
    { minute: 220, title: 'Confirm pressure recovery', status: 'Recovery observed', event: 'Successive pressure samples return to 101.3 kPa.',
      system: 'The upward transition is counted separately. The missing intervals still do not contribute to coverage.',
      crew: 'Records the recovery and checks for a sustained return to the starting pressure.' },
    { minute: 360, title: 'Review the shift record', status: 'Review complete', event: 'The remaining samples are stable through the end of the six-hour window.',
      system: 'The shift record shows two distinct transitions and separates measured time from the interval with unavailable telemetry.',
      crew: 'Hands over the pressure trace, the reported symptoms, and the period of missing data.' },
  ],
  outcome: 'Pressure returned to the starting level. The handover retains both the drop and the recovery, the missing intervals, and exercise as an alternative explanation for the higher pulse.',
  source: { label: 'NASA · Spacecraft environmental monitoring', url: 'https://www.nasa.gov/reference/crew-systems/' },
  related: { label: 'Open full pressure analysis', url: '/mission/pressure' },
}

const solar: MissionScenario = {
  id: 'solar-event', environment: 'Deep-space transit', title: 'Solar event during a relay outage', duration: '72 hours', subject: 'Yekta Erkuş · Transit crew',
  intro: 'A solar particle event raises the vehicle monitor reading while the scheduled Earth relay is unavailable. Follow local observations, the radiation trend, and the delayed ground handover.',
  topics: ['Radiation monitoring', 'Offline recording', 'Ground handover'],
  metrics: [
    { label: 'Cabin monitor dose rate', unit: 'µGy/h', range: [0, 280] },
    { label: 'Crew dosimeter total', unit: 'µGy', range: [0, 1600] },
  ],
  readings: [
    { minute: 0, values: [15, 0] },
    { minute: 12 * hour, values: [22, 180] },
    { minute: 18 * hour, values: [250, 430] },
    { minute: 22 * hour, values: [180, 520] },
    { minute: 32 * hour, values: [75, null] },
    { minute: 42 * hour, values: [30, 1040] },
    { minute: 54 * hour, values: [18, 1240] },
    { minute: 72 * hour, values: [15, 1510] },
  ],
  checkpoints: [
    { minute: 0, title: 'Start transit monitoring', status: 'Baseline', event: 'The crew begins a new observation window with the Earth relay available.',
      system: 'The cabin monitor reports a rate. The crew dosimeter reports a separate running total starting from this exercise window.',
      crew: 'Records each instrument, its location and its unit.' },
    { minute: 12 * hour, title: 'Relay window missed', status: 'Working offline', relay: 'outage', event: 'The expected Earth relay is unavailable as the cabin rate begins to rise.',
      system: 'The replay shows local observation capture while the ground link is unavailable.',
      crew: 'Notes the time the relay became unavailable and continues logging instrument readings.' },
    { minute: 18 * hour, title: 'Local radiation event', status: 'Handover queued', relay: 'queue', event: 'The cabin monitor reaches its highest observed reading in the exercise.',
      system: 'The simulated handover stays queued. Cabin rate and personal total are shown as separate quantities from different instruments.',
      crew: 'Marks the change of crew location in the exercise and adds the current dosimeter and check-in to the handover.' },
    { minute: 22 * hour, title: 'Continue local check-ins', status: 'Awaiting link', event: 'The crew records readings from the designated shielded area while the cabin monitor rate is still elevated.',
      system: 'The queued handover remains pending while new local observations appear in the timeline.',
      crew: 'Notes the different locations of the crew and vehicle monitor; the two readings describe different conditions.' },
    { minute: 32 * hour, title: 'Flag a missing dosimeter sample', status: 'Coverage gap', event: 'No personal dosimeter reading is available at this checkpoint.',
      system: 'The replay leaves a gap in the personal trace. It does not infer a personal reading from the cabin rate.',
      crew: 'Logs the missing sample with the rest of the context for ground review.' },
    { minute: 42 * hour, title: 'Restore the Earth relay', status: 'Handover sent', relay: 'reconnect', event: 'The relay returns and a new personal reading becomes available.',
      system: 'The queued handover moves to sent in the replay. Original event times are preserved separately from the send time.',
      crew: 'Checks the outgoing record for the peak observation, the location change, and the missing sample.' },
    { minute: 54 * hour, title: 'Ground acknowledges receipt', status: 'Receipt confirmed', relay: 'acknowledge', event: 'Ground acknowledges receipt at the next simulated review.',
      system: 'The replay distinguishes receipt from a clinical review. The rate is falling while the instrument total continues to accumulate.',
      crew: 'Records the acknowledgment and continues the final monitoring window.' },
    { minute: 72 * hour, title: 'Close the log window', status: 'Review complete', event: 'The final cabin reading returns to the starting rate in the exercise.',
      system: 'The recap retains the observed peak, the gap, and the simulated delivery trail. It does not convert instrument readings to an effective dose.',
      crew: 'Ends this observation window with the handover available for review.' },
  ],
  outcome: 'Local observations survive the fictional relay outage. The replay tracks when the handover was queued, sent, and acknowledged, including the dosimeter gap that ground needs to see.',
  source: { label: 'NASA · Solar particle events and crew dosimeters', url: 'https://science.nasa.gov/missions/artemis/artemis-2/to-protect-artemis-ii-astronauts-nasa-experts-keep-eyes-on-sun/' },
  related: { label: 'Open radiation research', url: '/research?view=radiation' },
}

export const missionScenarios = [lunar, pressure, solar] as const

export function scenarioFrame(scenario: MissionScenario, index: number) {
  const checkpoints = scenario.checkpoints.slice(0, index + 1)
  const checkpoint = checkpoints.at(-1)!
  const readings = scenario.readings.filter(reading => reading.minute <= checkpoint.minute)
  const latest = readings.at(-1)!
  const pressure = scenario.id === 'orbital-pressure'
    ? summarizePressure(pressureScenario.samples.slice(0, readings.length)) : undefined
  const relayEvents = checkpoints.filter(item => item.relay)
  const latestRelayEvent = relayEvents.at(-1)?.relay
  const relay = scenario.id === 'solar-event' ? {
    link: latestRelayEvent === 'outage' || latestRelayEvent === 'queue' ? 'Unavailable' : 'Available',
    handover: latestRelayEvent === 'acknowledge' ? 'Acknowledged' : latestRelayEvent === 'reconnect' ? 'Sent · awaiting receipt'
      : latestRelayEvent === 'queue' ? 'Queued locally' : 'No handover yet',
    queuedAt: relayEvents.find(item => item.relay === 'queue')?.minute,
    sentAt: relayEvents.find(item => item.relay === 'reconnect')?.minute,
    acknowledgedAt: relayEvents.find(item => item.relay === 'acknowledge')?.minute,
  } : undefined
  return { checkpoint, checkpoints, readings, latest, pressure, relay, complete: index === scenario.checkpoints.length - 1 }
}

export function missionElapsed(minute: number) {
  const parts = [Math.floor(minute / day), Math.floor(minute % day / hour), minute % hour]
    .flatMap((value, index) => value ? [`${value}${['d', 'h', 'm'][index]}`] : [])
  return `T+${parts.join(' ') || '0m'}`
}
