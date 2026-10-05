import type { PartLayout, PublishingBatch, ScoreComment, Track } from './types'

/**
 * 模拟出版服务器：
 * - 只追加的确认批次日志（最后确认批次可恢复）
 * - 修订号乐观锁：基线过期即 STALE_REVISION（先到者生效）
 * - 幂等键：同一编号重试只生效一次，不重复生成版本
 * - 可注入一次写入失败，模拟响应丢失
 */
let confirmedLog: PublishingBatch[] = []
let headRevision = 0
const commentsByRevision = new Map<number, ScoreComment[]>()
const idempotencyKeys = new Set<string>()
let failMode: 'none' | 'once' | 'always' = 'none'
/** 最后确认的完整快照（初始基线即 revision 0，保证随时可恢复） */
let lastConfirmed: PublishingBatch

export type WriteErrorCode = 'STALE_REVISION' | 'WRITE_FAILED'
export interface WriteResult { ok: boolean; error?: WriteErrorCode; revision?: number; duplicate?: boolean }

export function __resetServer(seed: { tracks: Track[]; comments: ScoreComment[]; parts: PartLayout[] }) {
  confirmedLog = []
  headRevision = 0
  commentsByRevision.clear()
  idempotencyKeys.clear()
  failMode = 'none'
  commentsByRevision.set(0, seed.comments)
  lastConfirmed = {
    id: 'B-000', revision: 0, status: 'confirmed', baseRevision: 0,
    author: '系统', time: '', summary: '初始基线',
    tracks: structuredClone(seed.tracks),
    comments: structuredClone(seed.comments),
    parts: structuredClone(seed.parts),
    conflicts: [],
  }
}

export function __setFailMode(mode: 'none' | 'once' | 'always') { failMode = mode }

export function getHeadRevision() { return headRevision }
export function getConfirmedLog() { return confirmedLog }
export function getLastConfirmed(): PublishingBatch { return lastConfirmed }
export function getServerComments(): ScoreComment[] { return commentsByRevision.get(headRevision) ?? [] }

function consumeFail(): boolean {
  if (failMode === 'always') return true
  if (failMode === 'once') { failMode = 'none'; return true }
  return false
}

export function submitBatch(batch: PublishingBatch): WriteResult {
  const key = batch.idempotencyKey ?? batch.id
  if (idempotencyKeys.has(key)) return { ok: true, revision: headRevision, duplicate: true }
  if (consumeFail()) return { ok: false, error: 'WRITE_FAILED' }
  headRevision += 1
  const confirmed: PublishingBatch = { ...batch, status: 'confirmed', revision: headRevision }
  confirmedLog.push(confirmed)
  idempotencyKeys.add(key)
  lastConfirmed = confirmed
  return { ok: true, revision: headRevision }
}

export function submitComment(comment: ScoreComment, baseRevision: number): WriteResult {
  const key = `comment:${comment.id}`
  if (idempotencyKeys.has(key)) return { ok: true, revision: headRevision, duplicate: true }
  if (baseRevision !== headRevision) return { ok: false, error: 'STALE_REVISION' }
  if (consumeFail()) return { ok: false, error: 'WRITE_FAILED' }
  headRevision += 1
  const prev = commentsByRevision.get(baseRevision) ?? []
  const comments = [...prev.filter((item) => item.id !== comment.id), comment]
  commentsByRevision.set(headRevision, comments)
  idempotencyKeys.add(key)
  lastConfirmed = { ...lastConfirmed, revision: headRevision, comments }
  return { ok: true, revision: headRevision }
}
