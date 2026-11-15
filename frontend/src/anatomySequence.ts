export type AnatomyPhase = 'intro' | 'out' | 'wide' | 'in' | 'hold'
export type AnatomyStage = { index: number; target: number; phase: AnatomyPhase; sequence: number; manual: boolean }
export const phaseDuration: Record<AnatomyPhase, number> = { intro: 1500, out: 1000, wide: 250, in: 1200, hold: 4000 }
export function initialStage(showIntro: boolean): AnatomyStage {
  return { index: showIntro ? 0 : 1, target: 1, phase: showIntro ? 'intro' : 'hold', sequence: 0, manual: false }
}
export function advanceStage(stage: AnatomyStage): AnatomyStage {
  const next = { ...stage, sequence: stage.sequence + 1 }
  switch (stage.phase) {
    case 'intro': return { ...next, index: stage.target, phase: 'in' }
    case 'hold': return { ...next, phase: 'out', target: stage.index === 3 ? 1 : stage.index + 1 }
    case 'out': return { ...next, phase: 'wide' }
    case 'wide': return { ...next, index: stage.target, phase: 'in' }
    case 'in': return { ...next, phase: 'hold', manual: false }
  }
}
export function selectStage(stage: AnatomyStage, target: number, reducedMotion: boolean): AnatomyStage {
  if (target < 1 || target > 3) return stage
  if (reducedMotion) return { index: target, target, phase: 'hold', sequence: stage.sequence + 1, manual: false }
  if (stage.phase === 'hold' && stage.index === target) return stage
  if (stage.phase !== 'hold' && stage.phase !== 'in') return { ...stage, target, manual: true }
  return { ...stage, target, phase: 'out', sequence: stage.sequence + 1, manual: true }
}
