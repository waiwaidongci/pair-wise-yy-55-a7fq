import type { OfflineDraft, PageBreakHint, ScoreComment, ScoreNote, ScoreVersion, Track } from './types'

const notes = (keys: string[]): ScoreNote[] => keys.map((key, index) => ({ id: `N-${index + 1}`, key, duration: index % 4 === 0 ? 'h' : 'q', dynamic: index < 2 ? 'mp' : 'mf', tie: index === 2, expression: index === 3 ? 'dolce' : '' }))

export const seedTracks: Track[] = [
  { id: 'TR-01', name: '长笛', instrument: 'Flute', clef: 'treble', transposition: 0, color: '#2563eb', notes: notes(['c/5','d/5','e/5','g/5','a/5','g/5','e/5','d/5','c/5','e/5','g/5','a/5']) },
  { id: 'TR-02', name: '单簧管', instrument: 'Clarinet in Bb', clef: 'treble', transposition: -2, color: '#7c3aed', notes: notes(['d/4','e/4','f/4','a/4','c/5','a/4','f/4','e/4','d/4','f/4','a/4','c/5']) },
  { id: 'TR-03', name: '圆号', instrument: 'Horn in F', clef: 'treble', transposition: -7, color: '#d97706', notes: notes(['g/3','a/3','c/4','d/4','e/4','d/4','c/4','a/3','g/3','c/4','d/4','e/4']) },
  { id: 'TR-04', name: '大提琴', instrument: 'Violoncello', clef: 'bass', transposition: 0, color: '#059669', notes: notes(['c/3','g/3','e/3','d/3','c/3','g/3','a/3','g/3','c/3','e/3','g/3','a/3']) },
]

export const seedComments: ScoreComment[] = [
  { id: 'CM-1', measure: 2, author: '指挥 · 方亦', content: '圆号第 2 小节进入需再弱一级，避免覆盖大提琴主题。', resolved: false, trackId: 'TR-03', status: 'active' },
  { id: 'CM-2', measure: 3, author: '作曲 · 沈青', content: '第 3 小节末音增加延音线，与下一小节第一拍连奏。', resolved: false, trackId: 'TR-01', status: 'active' },
  { id: 'CM-3', measure: 6, author: '出版 · 赵晴', content: '单簧管分谱需在换页处保留 2 小节提示音。', resolved: true, trackId: 'TR-02', status: 'active' },
]

export const seedVersions: ScoreVersion[] = [
  { id: 'v12', author: '沈青', time: '今天 16:28', summary: '调整终段和声，补充圆号力度与连音线', trackNotes: { 'TR-03': seedTracks[2]!.notes } },
  { id: 'v11', author: '方亦', time: '今天 14:10', summary: '移调单簧管分谱并调整换气标记', trackNotes: { 'TR-02': seedTracks[1]!.notes } },
]

export const seedHints: PageBreakHint[] = [
  { id: 'PB-TR-01-6', trackId: 'TR-01', beforeMeasure: 6, cueMeasures: 2, stale: false },
  { id: 'PB-TR-02-6', trackId: 'TR-02', beforeMeasure: 6, cueMeasures: 2, stale: false },
  { id: 'PB-TR-03-5', trackId: 'TR-03', beforeMeasure: 5, cueMeasures: 1, stale: false },
  { id: 'PB-TR-04-6', trackId: 'TR-04', beforeMeasure: 6, cueMeasures: 2, stale: false },
]

const measureNotes = (prefix: string, keys: string[], dynamic: ScoreNote['dynamic'], tieLast = false): ScoreNote[] =>
  keys.map((key, index) => ({ id: `${prefix}-${index + 1}`, key, duration: 'q' as const, dynamic, tie: tieLast && index === keys.length - 1, expression: '' }))

export const seedDrafts: OfflineDraft[] = [
  {
    id: 'OD-101', source: 'rehearsal', author: '指挥 · 方亦', revision: 12, status: '待收录', submittedAt: '今天 17:02',
    changes: [
      { kind: 'measure', anchor: 'M-02', trackId: 'TR-03', notes: measureNotes('R2', ['g/3', 'a/3', 'c/4', 'd/4'], 'pp') },
      { kind: 'comment', anchor: 'CM-1', measure: 2, author: '指挥 · 方亦', content: '圆号第 2 小节改为 pp，并在进入前留换气。', trackId: 'TR-03' },
      { kind: 'pageBreak', anchor: 'PB-TR-02-6', trackId: 'TR-02', beforeMeasure: 7, cueMeasures: 2 },
    ],
  },
  {
    id: 'OD-102', source: 'publishing', author: '出版 · 赵晴', revision: 12, status: '待收录', submittedAt: '今天 17:09',
    changes: [
      { kind: 'measure', anchor: 'M-02', trackId: 'TR-03', notes: measureNotes('P2', ['g/3', 'a/3', 'c/4', 'd/4'], 'mp', true) },
      { kind: 'comment', anchor: 'CM-1', measure: 2, author: '出版 · 赵晴', content: '圆号第 2 小节维持 mp，与已发排的总谱平衡。', trackId: 'TR-03' },
      { kind: 'transposition', anchor: 'TR-02', trackId: 'TR-02', semitones: -1 },
      { kind: 'measure', anchor: 'M-03', trackId: 'TR-01', notes: measureNotes('P3', ['c/5', 'e/5', 'g/5', 'b/5'], 'mf') },
    ],
  },
  {
    id: 'OD-097', source: 'rehearsal', author: '作曲 · 沈青', revision: null, status: '待收录', submittedAt: '昨天 21:40',
    changes: [
      { kind: 'measure', anchor: 'M-01', trackId: 'TR-04', notes: measureNotes('R1', ['c/3', 'g/3', 'e/3', 'g/3'], 'p') },
    ],
  },
]
