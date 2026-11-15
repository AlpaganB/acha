from dataclasses import dataclass
from typing import Literal

STANDARD = "https://standards.nasa.gov/node/237"
CREW_HEALTH = "https://www.nasa.gov/reference/nasa-std-3001v1/"
SLEEP = "https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=100"
COGNITION = "https://ntrs.nasa.gov/citations/20240012108"
EVIDENCE = "https://humanresearchroadmap.nasa.gov/evidence/"
RADIATION = "https://visualization.osdr.nasa.gov/radlab/gui/data-api/"
PERSONAL_DOSIMETRY = "https://standards.nasa.gov/standard/NASA/NASA-STD-3001_VOL_1"


@dataclass(frozen=True)
class Parameter:
    label: str
    category: str
    unit: str
    method: str
    cadence: str
    priority: str
    source: str
    minimum: float | None = 0
    maximum: float | None = None
    scope: str = "crew"
    input_kind: Literal["number", "event"] = "number"


def environment(label: str, unit: str, minimum: float | None = 0, maximum: float | None = None,
                source: str = STANDARD, priority: str = "P0") -> Parameter:
    return Parameter(label, "Atmosphere and operations", unit, "instrument_transcribed", "sensor spot reading",
                     priority, source, minimum, maximum, "environment")


def event(label: str, category: str, *, operations: bool = False) -> Parameter:
    return Parameter(label, category, "", "event_transcribed" if operations else "clinical_transcribed", "event",
                     "P1" if operations else "P2", STANDARD if operations else CREW_HEALTH, None, None,
                     "environment" if operations else "crew", "event")


def self_report(label: str, category: str, source: str = EVIDENCE) -> Parameter:
    return Parameter(label, category, "0–10", "self_report", "event or daily report", "P1", source, 0, 10)


def protocol_reading(label: str, category: str, unit: str, source: str = CREW_HEALTH) -> Parameter:
    return Parameter(label, category, unit, "protocol_transcribed", "protocol session", "P2", source)


PARAMETERS = {
    "cabin_pressure": environment("Cabin absolute pressure", "kPa"),
    "suit_pressure": environment("Suit absolute pressure", "kPa", priority="P2"),
    "cabin_ppo2": environment("Cabin oxygen partial pressure", "kPa"),
    "cabin_ppco2": environment("Cabin carbon dioxide partial pressure", "kPa"),
    "suit_ppo2": environment("Suit oxygen partial pressure", "kPa", priority="P2"),
    "suit_ppco2": environment("Suit carbon dioxide partial pressure", "kPa", priority="P2"),
    "ambient_co2": environment("Ambient carbon dioxide concentration", "ppm", 0, 1_000_000),
    "ambient_temperature": environment("Ambient temperature", "°C", -273.15),
    "relative_humidity": environment("Relative humidity", "%", 0, 100),
    "illuminance": environment("Measured illuminance", "lx", priority="P1"),
    "acceleration_magnitude": environment("Acceleration magnitude", "m/s²", priority="P2"),
    "pressure_event": event("Reported pressure transition", "Atmosphere and operations", operations=True),
    "eva_event": event("EVA or prebreathe record", "Atmosphere and operations", operations=True),
    "life_support_event": event("Life support observation", "Atmosphere and operations", operations=True),
    "absorbed_dose_rate": environment("Instrument absorbed dose rate", "µGy/h", source=RADIATION, priority="P1"),
    "dose_equivalent_rate": environment("Instrument dose equivalent rate", "µSv/h", source=RADIATION, priority="P1"),
    "personal_dose_equivalent_rate": Parameter("Individual dosimeter reported equivalent rate", "Radiation", "µSv/h",
                                               "instrument_transcribed", "device sample", "P1", PERSONAL_DOSIMETRY),
    "personal_absorbed_dose_rate": Parameter("Individual dosimeter absorbed dose rate", "Radiation", "µGy/h",
                                             "instrument_transcribed", "device sample", "P1", PERSONAL_DOSIMETRY),
    "personal_absorbed_dose_total": Parameter("Individual dosimeter absorbed dose counter", "Radiation", "mGy",
                                              "instrument_transcribed", "device sample", "P1", PERSONAL_DOSIMETRY),
    "personal_equivalent_dose_total": Parameter("Individual dosimeter total equivalent dose", "Radiation", "mSv",
                                                "instrument_transcribed", "device sample", "P1", PERSONAL_DOSIMETRY),
    "organ_equivalent_dose_estimate": Parameter("Modelled organ equivalent dose", "Radiation", "mSv",
                                                "protocol_transcribed", "model output", "P2", PERSONAL_DOSIMETRY),
    "effective_dose_estimate": Parameter("Modelled effective dose", "Radiation", "mSv", "protocol_transcribed",
                                         "model output", "P2", PERSONAL_DOSIMETRY),
    "nasa_career_effective_dose": Parameter("NASA-basis career effective dose", "Radiation assessment", "mSv",
                                           "clinical_transcribed", "reviewed model output", "P1", PERSONAL_DOSIMETRY),
    "organ_gray_equivalent_30d": Parameter("Thirty-day organ gray equivalent", "Radiation assessment", "mGy-Eq",
                                          "clinical_transcribed", "reviewed model output", "P1", PERSONAL_DOSIMETRY),
    "hippocampal_absorbed_30d": Parameter("Thirty-day hippocampal absorbed dose", "Radiation assessment", "mGy",
                                         "clinical_transcribed", "reviewed model output", "P1", PERSONAL_DOSIMETRY),
    "radiation_reid": Parameter("Lifetime extra cancer mortality (REID)", "Radiation assessment", "%",
                                "clinical_transcribed", "reviewed model output", "P1", "https://ntrs.nasa.gov/citations/20210013314", 0, 100),
    "radiation_reic": Parameter("Lifetime extra cancer incidence (REIC)", "Radiation assessment", "%",
                                "clinical_transcribed", "reviewed model output", "P1", "https://ntrs.nasa.gov/citations/20210013314", 0, 100),
    "heart_rate": Parameter("Heart rate", "Cardiorespiratory", "bpm", "instrument_transcribed", "spot", "P0", CREW_HEALTH),
    "spo2": Parameter("Blood oxygen saturation", "Cardiorespiratory", "%", "instrument_transcribed", "spot", "P0",
                      CREW_HEALTH, 0, 100),
    "respiratory_rate": Parameter("Respiratory rate", "Cardiorespiratory", "breaths/min", "manual_count", "spot", "P0", CREW_HEALTH),
    "systolic_bp": Parameter("Systolic arterial pressure", "Cardiorespiratory", "mmHg", "instrument_transcribed", "spot", "P0", CREW_HEALTH),
    "diastolic_bp": Parameter("Diastolic arterial pressure", "Cardiorespiratory", "mmHg", "instrument_transcribed", "spot", "P0", CREW_HEALTH),
    "resting_hrv_rmssd": Parameter("Resting heart rate variability (RMSSD)", "Cardiorespiratory", "ms", "instrument_transcribed", "protocol session", "P2", EVIDENCE),
    "ecg_rr_interval": Parameter("ECG R–R interval", "Cardiorespiratory", "ms", "instrument_transcribed",
                                 "beat interval", "P2", "https://physionet.org/content/bidmc/1.0.0/"),
    "end_tidal_co2": Parameter("End-tidal carbon dioxide", "Cardiorespiratory", "kPa", "instrument_transcribed",
                              "protocol session", "P2", CREW_HEALTH),
    "fev1": protocol_reading("Forced expiratory volume in one second", "Cardiorespiratory", "L"),
    "forced_vital_capacity": protocol_reading("Forced vital capacity", "Cardiorespiratory", "L"),
    "orthostatic_response": event("Orthostatic test findings", "Cardiorespiratory"),
    "ecg_observation": event("ECG or pulse rhythm observation", "Cardiorespiratory"),
    "exercise_recovery_heart_rate": protocol_reading("Heart rate at protocol-defined recovery time", "Cardiorespiratory", "bpm"),
    "breathing_difficulty": self_report("Reported breathing difficulty", "Cardiorespiratory"),
    "palpitations": self_report("Reported palpitations", "Cardiorespiratory"),
    "core_temperature": Parameter("Core temperature", "Thermal", "°C", "instrument_transcribed", "spot", "P1", CREW_HEALTH, -273.15),
    "skin_temperature": Parameter("Skin temperature", "Thermal", "°C", "instrument_transcribed", "spot", "P1", CREW_HEALTH, -273.15),
    "sleep_minutes": Parameter("Reported sleep in the previous 24 hours", "Sleep", "min", "self_report", "daily", "P1", SLEEP, 0, 1440),
    "sleep_latency_minutes": Parameter("Reported sleep onset latency", "Sleep", "min", "self_report", "daily", "P1", SLEEP, 0, 1440),
    "sleep_interruptions": Parameter("Reported sleep interruptions", "Sleep", "count", "self_report", "daily", "P1", SLEEP),
    "sleep_episode_minutes": Parameter("Sleep episode duration", "Sleep", "min", "protocol_transcribed",
                                        "episode", "P1", SLEEP, 0, 1440),
    "sleep_quality": self_report("Reported sleep quality (low to high)", "Sleep", SLEEP),
    "daytime_sleepiness": self_report("Reported daytime sleepiness", "Sleep", SLEEP),
    "reaction_time": Parameter("Median reaction time", "Cognition", "ms", "protocol_transcribed", "protocol session", "P1", COGNITION),
    "task_accuracy": Parameter("Task accuracy", "Cognition", "%", "protocol_transcribed", "protocol session", "P1", COGNITION, 0, 100),
    "sustained_attention_lapses": protocol_reading("Sustained-attention lapses", "Cognition", "count", COGNITION),
    "working_memory_accuracy": Parameter("Working-memory task accuracy", "Cognition", "%", "protocol_transcribed",
                                         "protocol session", "P2", COGNITION, 0, 100),
    "perceived_workload": Parameter("Reported workload", "Well-being", "0–10", "self_report", "daily", "P1", SLEEP, 0, 10),
    "perceived_stress": Parameter("Reported stress", "Well-being", "0–10", "self_report", "daily", "P1", EVIDENCE, 0, 10),
    "reported_mood": Parameter("Reported mood (low to high)", "Well-being", "0–10", "self_report", "daily", "P1", EVIDENCE, 0, 10),
    "fatigue": self_report("Reported fatigue", "Well-being"),
    "perceived_isolation": self_report("Reported social isolation", "Well-being"),
    "perceived_team_cohesion": self_report("Reported team cohesion (low to high)", "Well-being"),
    "perceived_wellbeing": self_report("Reported well-being (low to high)", "Well-being"),
    "headache": Parameter("Reported headache severity", "Symptoms", "0–10", "self_report", "event", "P1", EVIDENCE, 0, 10),
    "ear_fullness": Parameter("Reported ear fullness severity", "Symptoms", "0–10", "self_report", "event", "P1", STANDARD, 0, 10),
    "dizziness": Parameter("Reported dizziness severity", "Symptoms", "0–10", "self_report", "event", "P1", EVIDENCE, 0, 10),
    "nausea": Parameter("Reported nausea severity", "Symptoms", "0–10", "self_report", "event", "P1", EVIDENCE, 0, 10),
    "motion_sickness": self_report("Reported motion sickness", "Neurological and ocular"),
    "visual_symptom": event("Visual symptom or vision change", "Neurological and ocular"),
    "vision_assessment": event("Vision assessment or SANS-related finding", "Neurological and ocular"),
    "balance_assessment": event("Balance or coordination assessment", "Performance"),
    "musculoskeletal_pain": self_report("Reported musculoskeletal pain", "Performance"),
    "injury_observation": event("Injury observation", "Performance"),
    "resistance_session": event("Resistance training loads and repetitions", "Performance"),
    "exercise_minutes": Parameter("Exercise duration", "Performance", "min", "self_report", "session", "P1", EVIDENCE, 0, 1440),
    "gravity_exposure_minutes": Parameter("Recorded gravity exposure interval", "Mission exposure", "min",
                                           "protocol_transcribed", "interval", "P1", "https://www.nasa.gov/reference/4-0-human-performance/"),
    "grip_strength": Parameter("Grip strength", "Performance", "N", "protocol_transcribed", "protocol session", "P1", EVIDENCE),
    "skeletal_strength": Parameter("Protocol-specific skeletal muscle strength", "Performance", "N", "protocol_transcribed",
                                   "protocol session", "P1", "https://www.nasa.gov/reference/4-0-human-performance/"),
    "vo2_peak": Parameter("Measured peak oxygen uptake", "Cardiorespiratory", "mL/kg/min", "protocol_transcribed",
                          "protocol session", "P2", "https://ntrs.nasa.gov/citations/20240000934"),
    "fluid_intake": Parameter("Reported fluid intake", "Nutrition and renal", "mL", "self_report", "event", "P1", CREW_HEALTH),
    "energy_intake": Parameter("Reported energy intake", "Nutrition and renal", "kcal", "self_report", "event", "P1", CREW_HEALTH),
    "protein_intake": Parameter("Reported protein intake", "Nutrition and renal", "g", "self_report", "event", "P1", CREW_HEALTH),
    "sodium_intake": Parameter("Reported sodium intake", "Nutrition and renal", "mg", "self_report", "event", "P1", CREW_HEALTH),
    "meal_record": event("Meal and portion record", "Nutrition and renal"),
    "appetite": self_report("Reported appetite (low to high)", "Nutrition and renal"),
    "abdominal_discomfort": self_report("Reported abdominal discomfort", "Gastrointestinal and urinary"),
    "bowel_observation": event("Bowel symptoms or stool observation", "Gastrointestinal and urinary"),
    "urinary_discomfort": self_report("Reported urinary discomfort", "Gastrointestinal and urinary"),
    "urinary_observation": event("Urinary symptoms or voiding observation", "Gastrointestinal and urinary"),
    "body_mass": Parameter("Body mass", "Nutrition and renal", "kg", "instrument_transcribed", "periodic", "P1", CREW_HEALTH),
    "urine_volume": Parameter("Urine volume", "Nutrition and renal", "mL", "instrument_transcribed", "specimen or timed collection", "P1", EVIDENCE),
    "urine_specific_gravity": Parameter("Urine specific gravity", "Nutrition and renal", "ratio", "laboratory_transcribed", "specimen", "P2", EVIDENCE),
    "serum_creatinine": Parameter("Serum creatinine", "Clinical and laboratory", "µmol/L",
                                  "laboratory_transcribed", "specimen", "P2", EVIDENCE),
    "urine_creatinine": Parameter("Urine creatinine", "Clinical and laboratory", "mmol/L",
                                  "laboratory_transcribed", "specimen", "P2", EVIDENCE),
    "bone_mineral_density": Parameter("Bone mineral density (site-specific)", "Clinical and laboratory", "g/cm²", "clinical_transcribed", "periodic exam", "P2", EVIDENCE),
    "white_blood_cells": Parameter("White blood cell count", "Clinical and laboratory", "10⁹/L", "laboratory_transcribed", "specimen", "P2", EVIDENCE),
    "c_reactive_protein": Parameter("C-reactive protein", "Clinical and laboratory", "mg/L", "laboratory_transcribed", "specimen", "P2", EVIDENCE),
    "blood_glucose": Parameter("Blood glucose", "Clinical and laboratory", "mmol/L", "laboratory_transcribed", "specimen", "P2", CREW_HEALTH),
    "intraocular_pressure": Parameter("Intraocular pressure", "Clinical and laboratory", "mmHg", "clinical_transcribed", "periodic exam", "P2", EVIDENCE),
    "retinal_thickness": Parameter("Retinal thickness (OCT, site-specific)", "Clinical and laboratory", "µm", "clinical_transcribed", "periodic exam", "P2", EVIDENCE),
    "medical_encounter": event("Medical encounter or examination", "Clinical events"),
    "medical_history": event("Existing condition or injury history", "Clinical events"),
    "allergy_record": event("Allergy record", "Clinical events"),
    "medication_record": event("Medication administration or missed dose", "Clinical events"),
    "adverse_reaction": event("Observed adverse reaction", "Clinical events"),
    "infection_symptoms": event("Reported infection-related symptoms", "Immune and infection"),
    "wound_observation": event("Wound site and appearance", "Immune and infection"),
}
