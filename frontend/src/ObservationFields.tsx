import type { ObservationContext, ParameterDefinition, RadiationAssessmentContext, SleepEpisode } from './api'

export const codePattern = '[a-z][a-z0-9_\\-]{0,63}'
const sites = ['bone_mineral_density', 'skeletal_strength', 'intraocular_pressure', 'retinal_thickness']
const specimens = ['urine_specific_gravity', 'white_blood_cells', 'serum_creatinine', 'urine_creatinine']
const assessmentBases: Record<string, RadiationAssessmentContext['basis']> = {
  nasa_career_effective_dose: 'nasa_career_effective',
  organ_gray_equivalent_30d: 'organ_gray_equivalent',
  hippocampal_absorbed_30d: 'hippocampal_absorbed',
  radiation_reid: 'lifetime_cancer_risk',
  radiation_reic: 'lifetime_cancer_risk',
}

export function utcInput(value: FormDataEntryValue | null) {
  const date = new Date(String(value) + 'Z')
  if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid UTC date and time.')
  return date.toISOString()
}

function CodeField({ name, label }: { name: string; label: string }) {
  return <label>{label}<input name={name} maxLength={64} pattern={codePattern} required /></label>
}

function SourceField() {
  return <label>Source reference<input name="source_ref" maxLength={120} required /></label>
}

function ProtocolFields() {
  return <>
    <CodeField name="protocol" label="Protocol code" />
    <CodeField name="version" label="Protocol version" />
  </>
}

function SessionFields() {
  return <>
    <CodeField name="shift" label="Shift code" />
    <label>Session UTC offset (minutes)<input name="utc_offset_minutes" type="number"
      min="-840" max="840" defaultValue={-new Date().getTimezoneOffset()} required /></label>
    <label>Ambient light (lx)<input name="illuminance_lux" type="number" step="any" min="0" /></label>
    <label>Reported workload (0–10)<input name="workload" type="number" step="any" min="0" max="10" /></label>
  </>
}

export function derivedDuration(kind: ParameterDefinition['context_kind']) {
  return kind === 'sleep_episode' || kind === 'exercise_interval' || kind === 'gravity_interval'
}

function IntervalFields() {
  return <>
    <label>Started (UTC)<input name="interval_start" type="datetime-local" required /></label>
    <label>Ended (UTC)<input name="interval_end" type="datetime-local" required /></label>
  </>
}

function RadiationAssessmentFields({ parameter }: { parameter: ParameterDefinition }) {
  const basis = assessmentBases[parameter.id]
  return <>
    <label>Model name<input name="model" maxLength={120} required /></label>
    <label>Model version<input name="model_version" maxLength={120} required /></label>
    <SourceField />
    <label>Exposure inputs reference<input name="input_manifest_ref" maxLength={120} required /></label>
    <label>Radiation safety review reference<input name="review_ref" maxLength={120} required /></label>
    <label>Exposure start (UTC)<input name="exposure_start" type="datetime-local" required /></label>
    <label>Exposure end (UTC)<input name="exposure_end" type="datetime-local" required /></label>
    <label>Reported lower bound ({parameter.unit})<input name="model_lower" type="number" min="0" step="any" required /></label>
    <label>Reported upper bound ({parameter.unit})<input name="model_upper" type="number" min="0" step="any" required /></label>
    <label>Reported interval definition<input name="interval_description" maxLength={120} required /></label>
    {basis === 'organ_gray_equivalent' && <label>Organ<select name="tissue">
      <option value="lens">Lens</option><option value="skin">Skin</option>
      <option value="blood_forming_organs">Blood-forming organs</option><option value="circulatory_system">Circulatory system</option>
    </select></label>}
    <label>Exposure coverage<select name="complete_history"><option value="no">Partial or unknown</option>
      <option value="yes">Complete reported window</option></select></label>
    {basis === 'nasa_career_effective' && <>
      <label>Upcoming mission projection<select name="includes_mission_projection"><option value="no">Missing or unknown</option>
        <option value="yes">Included under NASA reference convention</option></select></label>
      <label>Medical and biomedical exposures<select name="excludes_medical_exposure"><option value="no">Included or unknown</option>
        <option value="yes">Excluded from this career limit result</option></select></label>
    </>}
  </>
}

export function ObservationFields({ parameter }: { parameter: ParameterDefinition }) {
  switch (parameter.context_kind) {
    case 'reading':
      return <>
        <label>Measurement position<select name="posture"><option value="unknown">Unknown</option>
          <option value="seated">Seated</option><option value="supine">Supine</option>
          <option value="standing">Standing</option><option value="restrained">Restrained</option>
          <option value="free_floating">Free floating</option>
        </select></label>
        <label>Timing relative to activity or a meal<select name="timing"><option value="unknown">Unknown</option>
          <option value="resting">Resting</option><option value="after_exercise">After exercise</option>
          <option value="before_meal">Before a meal</option><option value="after_meal">After a meal</option>
        </select></label>
      </>
    case 'exercise_interval':
      return <>
        <IntervalFields />
        <label>Exercise mode<select name="exercise_mode"><option value="aerobic">Aerobic</option>
          <option value="resistance">Resistance</option><option value="mixed">Mixed</option>
          <option value="mobility">Mobility</option>
        </select></label>
        <label>Reported intensity<select name="intensity"><option value="unknown">Unknown</option>
          <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
        </select></label>
      </>
    case 'gravity_interval':
      return <>
        <IntervalFields />
        <label>Gravity regime<select name="regime"><option value="unknown">Unknown</option>
          <option value="microgravity">Microgravity</option><option value="partial_gravity">Partial gravity</option>
          <option value="one_g">1 g</option>
        </select></label>
        <SourceField />
      </>
    case 'radiation':
      return <>
        <SourceField />
        <label>Detector geometry reference<input name="geometry_ref" maxLength={120} required /></label>
        <label>Shielding reference<input name="shielding_ref" maxLength={120} required /></label>
        <label>Particle class<input name="particle_class" maxLength={120} required /></label>
      </>
    case 'dose_estimate':
      return <>
        <SourceField />
        <label>Dose model and version<input name="model_version" maxLength={120} required /></label>
        {parameter.id === 'organ_equivalent_dose_estimate' && <label>Organ or tissue<input name="tissue" maxLength={120} required /></label>}
      </>
    case 'radiation_assessment':
      return <RadiationAssessmentFields parameter={parameter} />
    case 'protocol':
      return <>
        <ProtocolFields />
        <SourceField />
        {sites.includes(parameter.id) && <label>Body site<input name="body_site" maxLength={120}
          list={parameter.id === 'bone_mineral_density' ? 'approved-bone-sites' : undefined} required /></label>}
        {parameter.id === 'bone_mineral_density' && <datalist id="approved-bone-sites">
          {['total_hip_left', 'total_hip_right', 'lumbar_spine_l1_l4', 'femoral_neck_left', 'femoral_neck_right']
            .map(site => <option key={site} value={site} />)}
        </datalist>}
        {specimens.includes(parameter.id) && <label>Specimen reference<input name="specimen" maxLength={120} required /></label>}
      </>
    case 'performance':
      return <>
        <ProtocolFields />
        <label>Attempted trials<input name="trials" type="number" min="1" max="10000" required /></label>
        <label>Valid trials<input name="valid_trials" type="number" min="1" max="10000" required /></label>
        <SessionFields />
      </>
    case 'sleep_episode':
      return <>
        <label>Sleep method<select name="method"><option value="self_report">Self report</option>
          <option value="actigraphy">Actigraphy</option><option value="polysomnography">Polysomnography</option>
        </select></label>
        <label>Attempted sleep (UTC)<input name="attempted_sleep_at" type="datetime-local" required /></label>
        <label>Sleep onset (UTC)<input name="sleep_onset_at" type="datetime-local" required /></label>
        <label>Final wake (UTC)<input name="final_wake_at" type="datetime-local" required /></label>
        <label>Out of bed (UTC)<input name="out_of_bed_at" type="datetime-local" required /></label>
        <label>Awake after onset (min)<input name="awake_after_onset_minutes" type="number" min="0" step="any" required /></label>
        <label>Sleep interruptions<input name="interruptions" type="number" min="0" max="1440" required /></label>
        <SessionFields />
      </>
    default:
      return null
  }
}

export function readObservationContext(fields: FormData, parameter: ParameterDefinition): ObservationContext | null {
  const kind = parameter.context_kind
  const text = (key: string) => String(fields.get(key) ?? '').trim()
  const optionalNumber = (key: string) => text(key) === '' ? null : Number(text(key))
  const protocol = { protocol: text('protocol'), version: text('version') }
  const conditions = {
    shift: text('shift'), utc_offset_minutes: Number(text('utc_offset_minutes')),
    illuminance_lux: optionalNumber('illuminance_lux'), workload: optionalNumber('workload'),
  }
  switch (kind) {
    case 'reading':
      return { kind, posture: text('posture'), timing: text('timing') }
    case 'exercise_interval':
      return { kind, start: utcInput(fields.get('interval_start')), end: utcInput(fields.get('interval_end')),
        mode: text('exercise_mode'), intensity: text('intensity') }
    case 'gravity_interval':
      return { kind, start: utcInput(fields.get('interval_start')), end: utcInput(fields.get('interval_end')),
        regime: text('regime'), source_ref: text('source_ref') }
    case 'radiation':
      return { kind, source_ref: text('source_ref'), geometry_ref: text('geometry_ref'),
        shielding_ref: text('shielding_ref'), particle_class: text('particle_class') }
    case 'dose_estimate':
      return { kind, source_ref: text('source_ref'), model_version: text('model_version'), tissue: text('tissue') || null }
    case 'radiation_assessment': {
      const basis = assessmentBases[parameter.id]
      return { kind, basis, model: text('model'), model_version: text('model_version'), source_ref: text('source_ref'),
        input_manifest_ref: text('input_manifest_ref'), review_ref: text('review_ref'),
        exposure_start: utcInput(fields.get('exposure_start')), exposure_end: utcInput(fields.get('exposure_end')),
        lower: Number(text('model_lower')), upper: Number(text('model_upper')), interval_description: text('interval_description'),
        tissue: basis === 'hippocampal_absorbed' ? 'hippocampus' : text('tissue') || null,
        complete_history: text('complete_history') === 'yes', includes_mission_projection: text('includes_mission_projection') === 'yes',
        excludes_medical_exposure: text('excludes_medical_exposure') === 'yes',
      }
    }
    case 'protocol':
      return { kind, ...protocol, source_ref: text('source_ref'), body_site: text('body_site') || null, specimen: text('specimen') || null }
    case 'performance':
      return { kind, ...protocol, ...conditions, trials: Number(text('trials')), valid_trials: Number(text('valid_trials')) }
    case 'sleep_episode':
      return {
        kind, ...conditions, method: text('method') as SleepEpisode['method'],
        attempted_sleep_at: utcInput(fields.get('attempted_sleep_at')),
        sleep_onset_at: utcInput(fields.get('sleep_onset_at')),
        final_wake_at: utcInput(fields.get('final_wake_at')),
        out_of_bed_at: utcInput(fields.get('out_of_bed_at')),
        awake_after_onset_minutes: Number(text('awake_after_onset_minutes')), interruptions: Number(text('interruptions')),
      }
    default:
      return null
  }
}
