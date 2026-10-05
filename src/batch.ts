import type {
  BatchResult,
  CommentChange,
  MeasureChange,
  MergeConflict,
  OfflineChange,
  OfflineDraft,
  PageBreakChange,
  PageBreakHint,
  PublishBatch,
  ScoreComment,
  Track,
  TranspositionChange,
} from './types'
import { NOTES_PER_MEASURE } from './types'

export const SOURCE_LABEL: Record<string, string> = { rehearsal: '排练室', publishing: '出版室' }

/** 出版排版按作品总小节数计算（音符数组仅为片段采样） */
export const TOTAL_MEASURES = 12

export function measureOfAnchor(anchor: string): number {
  return Number(anchor.replace(/^M-0?/, ''))
}

/** 移调改变排版密度：重算该声部换页提示（每页小节数随移调乐器谱面加宽而减少） */
export function recomputeHintsForTrack(track: Track, hints: PageBreakHint[]): PageBreakHint[] {
  const measuresPerPage = Math.abs(track.transposition) >= 5 ? 4 : 5
  const totalMeasures = Math.max(TOTAL_MEASURES, Math.ceil(track.notes.length / NOTES_PER_MEASURE))
  const recomputed: PageBreakHint[] = []
  for (let boundary = measuresPerPage + 1; boundary <= totalMeasures + 1; boundary += measuresPerPage) {
    recomputed.push({
      id: `PB-${track.id}-${boundary}`,
      trackId: track.id,
      beforeMeasure: boundary,
      cueMeasures: 2,
      stale: false,
      note: `已按移调 ${track.transposition > 0 ? '+' : ''}${track.transposition} 重算`,
    })
  }
  const others = hints.filter((hint) => hint.trackId !== track.id)
  return [...others, ...(recomputed.length ? recomputed : [{ id: `PB-${track.id}-0`, trackId: track.id, beforeMeasure: 0, cueMeasures: 0, stale: false, note: '无需换页' }])]
}

/** 移调变化 → 该声部旧评论失效待重算，分谱换页提示失效并重算 */
export function applyTranspositionInvalidation(
  track: Track,
  comments: ScoreComment[],
  hints: PageBreakHint[],
  log: string[],
): { comments: ScoreComment[]; hints: PageBreakHint[] } {
  const nextComments = comments.map((comment) => {
    if (comment.trackId !== track.id || comment.status === 'superseded') return comment
    if (comment.status === 'stale') return comment
    log.push(`评论 ${comment.id}（第 ${comment.measure} 小节）失效，待按新移调重算`)
    return { ...comment, status: 'stale' as const, recalculated: false }
  })
  const staleHints = hints.filter((hint) => hint.trackId === track.id && !hint.stale)
  staleHints.forEach((hint) => log.push(`换页提示 ${hint.id}（第 ${hint.beforeMeasure} 小节前）失效，已重算`))
  return { comments: nextComments, hints: recomputeHintsForTrack(track, hints) }
}

export function applyMeasureChange(tracks: Track[], change: MeasureChange): Track[] {
  const measure = measureOfAnchor(change.anchor)
  return tracks.map((track) => {
    if (track.id !== change.trackId) return track
    const notes = [...track.notes]
    notes.splice((measure - 1) * NOTES_PER_MEASURE, NOTES_PER_MEASURE, ...change.notes)
    return { ...track, notes }
  })
}

function applyTranspositionChange(tracks: Track[], change: TranspositionChange): Track[] {
  return tracks.map((track) => {
    if (track.id !== change.trackId) return track
    const delta = change.semitones - track.transposition
    return { ...track, transposition: change.semitones, notes: track.notes.map((note) => ({ ...note, key: shiftKey(note.key, delta) })) }
  })
}

export function shiftKey(key: string, semitones: number): string {
  const chromatic = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
  const [pitch, octaveText] = key.split('/')
  let index = chromatic.indexOf(pitch!.replace('b', '')) + semitones
  let octave = Number(octaveText)
  while (index < 0) { index += 12; octave -= 1 }
  while (index >= 12) { index -= 12; octave += 1 }
  return `${chromatic[index]}/${octave}`
}

function samePayload(a: MeasureChange | CommentChange, b: MeasureChange | CommentChange): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 离线改动按现场编号合并：
 * - 仅一边改过的锚点直接合并；
 * - 同一小节或评论两边都改过且内容不同 → 各留一份待裁决，基线值保持生效；
 * - 移调改动生效的同时让旧评论与换页提示失效重算。
 */
export function mergeDrafts(
  base: BatchResult,
  drafts: OfflineDraft[],
  meta: { id: string; revision: number; createdAt: string },
): PublishBatch {
  let tracks = structuredClone(base.tracks)
  let comments: ScoreComment[] = structuredClone(base.comments)
  let hints = structuredClone(base.hints)
  const conflicts: MergeConflict[] = []
  const appliedLog: string[] = []
  const invalidations: string[] = []
  const promotions: string[] = []

  // 旧稿无修订号 → 升为首版待确认
  const normalized = drafts.map((draft) => {
    if (draft.revision !== null) return draft
    promotions.push(`${draft.id}（${draft.author}）无修订号，已升为首版待确认 rev 1`)
    return { ...draft, revision: 1, status: '首版待确认' as const }
  })

  // 按现场编号归集两边的改动
  const byAnchor = new Map<string, { source: string; change: OfflineChange }[]>()
  normalized.forEach((draft) => {
    draft.changes.forEach((change) => {
      const list = byAnchor.get(change.anchor) ?? []
      list.push({ source: draft.source, change })
      byAnchor.set(change.anchor, list)
    })
  })

  byAnchor.forEach((entries, anchor) => {
    const first = entries[0]!.change
    if (first.kind === 'measure' || first.kind === 'comment') {
      const sides = entries.filter((entry) => entry.source !== entries[0]!.source)
      const mine = entries.find((entry) => entry.source === entries[0]!.source)!
      if (sides.length > 0 && !samePayload(mine.change as MeasureChange | CommentChange, sides[0]!.change as MeasureChange | CommentChange)) {
        // 两边都改过同一小节/评论：各留一份待裁决，基线不动
        conflicts.push({
          id: `CF-${anchor}`,
          anchor,
          kind: first.kind,
          sides: [mine, sides[0]!] as MergeConflict['sides'],
          status: '待裁决',
        })
        appliedLog.push(`${anchor} 两边均有改动，各留一份待裁决`)
        return
      }
      // 单边改动（或两边一致）：直接合并
      if (first.kind === 'measure') {
        tracks = applyMeasureChange(tracks, first)
        appliedLog.push(`合并 ${anchor}（${SOURCE_LABEL[mine.source]}）：${first.trackId} 第 ${measureOfAnchor(anchor)} 小节`)
      } else {
        const existing = comments.find((comment) => comment.id === first.anchor)
        comments = existing
          ? comments.map((comment) => (comment.id === first.anchor ? { ...comment, content: (first as CommentChange).content, author: (first as CommentChange).author } : comment))
          : [...comments, { id: first.anchor, measure: first.measure, author: first.author, content: first.content, resolved: false, trackId: first.trackId, status: 'active' as const }]
        appliedLog.push(`合并评论 ${anchor}（${SOURCE_LABEL[mine.source]}）`)
      }
      return
    }
    if (first.kind === 'transposition') {
      tracks = applyTranspositionChange(tracks, first)
      const track = tracks.find((item) => item.id === first.trackId)!
      appliedLog.push(`合并移调 ${anchor}（${SOURCE_LABEL[entries[0]!.source]}）：${track.name} 移调 ${track.transposition > 0 ? '+' : ''}${track.transposition}`)
      const invalidated = applyTranspositionInvalidation(track, comments, hints, invalidations)
      comments = invalidated.comments
      hints = invalidated.hints
      return
    }
    // pageBreak 提示音调整：单边改动直接合并
    hints = hints.map((hint) => (hint.id === anchor ? { ...hint, beforeMeasure: (first as PageBreakChange).beforeMeasure, cueMeasures: (first as PageBreakChange).cueMeasures, stale: false } : hint))
    appliedLog.push(`合并换页提示 ${anchor}（${SOURCE_LABEL[entries[0]!.source]}）`)
  })

  return {
    id: meta.id,
    revision: meta.revision,
    status: '待确认',
    createdAt: meta.createdAt,
    attempts: 0,
    sourceDrafts: normalized.map((draft) => draft.id),
    promotions,
    invalidations,
    conflicts,
    appliedLog,
    result: { tracks, comments, hints },
  }
}
