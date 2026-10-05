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
  trackId?: string
  author: string
  content: string
  resolved: boolean
  sceneNo?: string
  /** 移调后锚点失效，待重新锚定 */
  stale?: boolean
}

export interface ScoreVersion {
  id: string
  author: string
  time: string
  summary: string
  trackNotes: Record<string, ScoreNote[]>
  revision?: number
}

/** 分谱排版：换页提示与提示音，移调后失效待重算 */
export interface PartLayout {
  trackId: string
  pageTurnMeasure: number
  cueMeasure: number
  stale: boolean
  reason?: string
}

/** 出版批次状态：草稿 / 待确认 / 已确认 */
export type BatchStatus = 'draft' | 'pending' | 'confirmed'

/** 可恢复的出版批次：总谱、移调、评论与分谱排版的一致快照 */
export interface PublishingBatch {
  id: string
  revision: number
  status: BatchStatus
  baseRevision: number
  sceneNo?: string
  author: string
  time: string
  summary: string
  tracks: Track[]
  comments: ScoreComment[]
  parts: PartLayout[]
  conflicts: MergeConflict[]
  /** 幂等键：重试时按原编号去重，不重复生成版本 */
  idempotencyKey?: string
}

/** 合并冲突：同一小节或评论两边都改过，各留一份待裁决 */
export interface MergeConflict {
  id: string
  kind: 'measure' | 'comment'
  entityId: string
  sceneNo: string
  local: unknown
  remote: unknown
  status: 'pending' | 'accepted'
  acceptedSide?: 'local' | 'remote'
}

/** 离线改动：带现场编号，按编号合并 */
export interface OfflineChange<T = unknown> {
  sceneNo: string
  baseRevision: number
  kind: 'measure' | 'comment'
  entityId: string
  after: T
}
