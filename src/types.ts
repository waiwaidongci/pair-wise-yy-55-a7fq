export interface ScoreNote {
  id: string
  key: string
  duration: 'q' | 'h' | '8'
  accidental?: '#' | 'b' | 'n'
  dynamic: 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'
  tie: boolean
  expression: string
}

export interface Track {
  id: string
  name: string
  instrument: string
  clef: 'treble' | 'bass' | 'alto'
  transposition: number
  color: string
  notes: ScoreNote[]
}

export interface ScoreComment {
  id: string
  measure: number
  author: string
  content: string
  resolved: boolean
  /** 锚定声部；移调该声部时评论失效待重算 */
  trackId?: string
  /** active 生效 / stale 移调失效待重算 / superseded 并发提交后到未生效 */
  status?: 'active' | 'stale' | 'superseded'
  /** 到达序号，评论并发先到先得的依据 */
  arrival?: number
  /** 失效后已按当前移调重算确认 */
  recalculated?: boolean
}

export interface ScoreVersion {
  id: string
  author: string
  time: string
  summary: string
  trackNotes: Record<string, ScoreNote[]>
}

/** 离线改动来源：排练室 / 出版室 */
export type RoomSource = 'rehearsal' | 'publishing'

export const NOTES_PER_MEASURE = 4

/** 现场编号：小节为 M-序号，评论为评论号，移调/换页为声部或提示音编号 */
export interface MeasureChange {
  kind: 'measure'
  anchor: string
  trackId: string
  notes: ScoreNote[]
}

export interface CommentChange {
  kind: 'comment'
  anchor: string
  measure: number
  author: string
  content: string
  trackId?: string
}

export interface TranspositionChange {
  kind: 'transposition'
  anchor: string
  trackId: string
  /** 新的绝对移调半音数 */
  semitones: number
}

export interface PageBreakChange {
  kind: 'pageBreak'
  anchor: string
  trackId: string
  beforeMeasure: number
  cueMeasures: number
}

export type OfflineChange = MeasureChange | CommentChange | TranspositionChange | PageBreakChange

export interface OfflineDraft {
  id: string
  source: RoomSource
  author: string
  /** 旧稿可能无修订号，合并时升为首版待确认 */
  revision: number | null
  status: '待收录' | '首版待确认' | '已合并'
  submittedAt: string
  changes: OfflineChange[]
}

/** 同一小节或评论两边都改过：各留一份待裁决 */
export interface MergeConflict {
  id: string
  anchor: string
  kind: 'measure' | 'comment'
  sides: { source: RoomSource; change: MeasureChange | CommentChange }[]
  status: '待裁决' | '已裁决'
  kept?: RoomSource
}

export interface PageBreakHint {
  id: string
  trackId: string
  beforeMeasure: number
  cueMeasures: number
  /** 移调后失效，等待重算 */
  stale: boolean
  note?: string
}

export type BatchStatus = '待确认' | '已确认' | '写入失败'

export interface BatchResult {
  tracks: Track[]
  comments: ScoreComment[]
  hints: PageBreakHint[]
}

export interface PublishBatch {
  id: string
  /** 版本号：创建时分配，重试沿用原编号，不重复生成版本 */
  revision: number
  status: BatchStatus
  createdAt: string
  attempts: number
  sourceDrafts: string[]
  /** 无修订号旧稿的升版记录 */
  promotions: string[]
  /** 移调导致的评论/换页提示失效重算记录 */
  invalidations: string[]
  conflicts: MergeConflict[]
  appliedLog: string[]
  result: BatchResult
}
