import { configureStore, createSlice, current, type PayloadAction } from '@reduxjs/toolkit'
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BatchResult, CommentChange, MeasureChange, RoomSource, ScoreComment, ScoreNote, ScoreVersion, Track } from './types'
import type { OfflineDraft, PageBreakHint, PublishBatch } from './types'
import { applyMeasureChange, applyTranspositionInvalidation, mergeDrafts, shiftKey } from './batch'
import { seedComments, seedDrafts, seedHints, seedTracks, seedVersions } from './mock'

interface ScoreState {
  tracks: Track[]
  selectedTrackId: string
  selectedNoteIndex: number
  history: string[]
  future: string[]
  comments: ScoreComment[]
  versions: ScoreVersion[]
  dirty: boolean
  drafts: OfflineDraft[]
  batches: PublishBatch[]
  hints: PageBreakHint[]
  /** 最后确认批次的快照：写入失败后的恢复点 */
  lastConfirmed: { batchId: string; snapshot: BatchResult }
  /** 版本/批次共用的修订序号，重试沿用原编号、不重复生成 */
  nextRevision: number
  commentSeq: number
  commentArrivalSeq: number
  simulateWriteFailure: boolean
}

const initialState: ScoreState = {
  tracks: structuredClone(seedTracks), selectedTrackId: 'TR-01', selectedNoteIndex: 2, history: [], future: [], comments: structuredClone(seedComments), versions: structuredClone(seedVersions), dirty: false,
  drafts: structuredClone(seedDrafts),
  batches: [],
  hints: structuredClone(seedHints),
  lastConfirmed: { batchId: 'PB-000', snapshot: { tracks: structuredClone(seedTracks), comments: structuredClone(seedComments), hints: structuredClone(seedHints) } },
  nextRevision: 13,
  commentSeq: 4,
  commentArrivalSeq: 1,
  simulateWriteFailure: false,
}

function snapshot(state: ScoreState) { state.history.push(JSON.stringify(state.tracks)); if (state.history.length > 40) state.history.shift(); state.future = []; state.dirty = true; localStorage.setItem('yy55-score-draft', JSON.stringify({ tracks: state.tracks, comments: state.comments })) }

const scoreSlice = createSlice({
  name: 'score',
  initialState,
  reducers: {
    selectTrack(state, action: PayloadAction<string>) { state.selectedTrackId = action.payload; state.selectedNoteIndex = 0 },
    selectNote(state, action: PayloadAction<number>) { state.selectedNoteIndex = action.payload },
    addNote(state) {
      snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!; const template = track.notes[Math.min(track.notes.length - 1, state.selectedNoteIndex)]
      track.notes.splice(state.selectedNoteIndex + 1, 0, { id: `N-${Date.now()}`, key: template?.key ?? 'c/4', duration: 'q', dynamic: template?.dynamic ?? 'mf', tie: false, expression: '' }); state.selectedNoteIndex += 1
    },
    removeNote(state) { snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!; if (track.notes.length > 1) track.notes.splice(state.selectedNoteIndex, 1); state.selectedNoteIndex = Math.max(0, state.selectedNoteIndex - 1) },
    updateNote(state, action: PayloadAction<Partial<ScoreNote>>) { snapshot(state); const track = state.tracks.find((item) => item.id === state.selectedTrackId)!; Object.assign(track.notes[state.selectedNoteIndex]!, action.payload) },
    transposeTrack(state, action: PayloadAction<number>) {
      snapshot(state)
      const track = state.tracks.find((item) => item.id === state.selectedTrackId)!
      track.notes.forEach((note) => { note.key = shiftKey(note.key, action.payload) })
      track.transposition += action.payload
      // 移调一变：该声部旧评论失效待重算，分谱换页提示失效并重算
      const invalidated = applyTranspositionInvalidation(track, state.comments, state.hints, [])
      state.comments = invalidated.comments
      state.hints = invalidated.hints
    },
    undo(state) { const previous = state.history.pop(); if (!previous) return; state.future.push(JSON.stringify(state.tracks)); state.tracks = JSON.parse(previous); state.dirty = true },
    redo(state) { const next = state.future.pop(); if (!next) return; state.history.push(JSON.stringify(state.tracks)); state.tracks = JSON.parse(next); state.dirty = true },
    resolveComment(state, action: PayloadAction<string>) { const comment = state.comments.find((item) => item.id === action.payload); if (comment) comment.resolved = true; state.dirty = true },
    saveVersion(state) {
      const revision = state.nextRevision++
      if (!state.versions.some((version) => version.id === `v${revision}`)) {
        state.versions.unshift({ id: `v${revision}`, author: '当前用户', time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), summary: '保存当前总谱与分谱调整', trackNotes: Object.fromEntries(current(state).tracks.map((track) => [track.id, structuredClone(track.notes)])) })
      }
      state.dirty = false; localStorage.removeItem('yy55-score-draft')
    },
    restoreDraft(state) { const raw = localStorage.getItem('yy55-score-draft'); if (!raw) return; const draft = JSON.parse(raw); state.tracks = draft.tracks; state.comments = draft.comments; state.dirty = true },

    /** 离线草稿按现场编号合并为出版批次；无修订号旧稿升为首版待确认 */
    createBatch(state) {
      const plain = current(state)
      const pending = plain.drafts.filter((draft) => draft.status !== '已合并')
      if (!pending.length) return
      const revision = plain.nextRevision
      const batch = mergeDrafts(
        { tracks: plain.tracks, comments: plain.comments, hints: plain.hints },
        structuredClone(pending),
        { id: `PB-${String(revision).padStart(3, '0')}`, revision, createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) },
      )
      state.nextRevision = revision + 1
      state.batches.unshift(batch)
      state.drafts = state.drafts.map((draft) => {
        if (draft.status === '已合并') return draft
        return { ...draft, revision: draft.revision ?? 1, status: '已合并' }
      })
    },

    /** 冲突裁决：保留一边，另一边作废 */
    adjudicateConflict(state, action: PayloadAction<{ batchId: string; conflictId: string; keep: RoomSource }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || batch.status !== '待确认') return
      const conflict = batch.conflicts.find((item) => item.id === action.payload.conflictId)
      if (!conflict || conflict.status !== '待裁决') return
      const kept = conflict.sides.find((side) => side.source === action.payload.keep)!
      if (conflict.kind === 'measure') {
        batch.result.tracks = applyMeasureChange(batch.result.tracks, kept.change as MeasureChange)
      } else {
        const change = kept.change as CommentChange
        batch.result.comments = batch.result.comments.map((comment) =>
          comment.id === change.anchor ? { ...comment, content: change.content, author: change.author } : comment,
        )
      }
      conflict.status = '已裁决'
      conflict.kept = action.payload.keep
      batch.appliedLog.push(`裁决 ${conflict.anchor}：保留${action.payload.keep === 'rehearsal' ? '排练室' : '出版室'}版`)
    },

    /**
     * 确认写入批次。失败时从最后确认批次恢复；
     * 重试沿用原批次编号与修订号，不重复生成版本。
     */
    confirmBatch(state, action: PayloadAction<string>) {
      const batch = state.batches.find((item) => item.id === action.payload)
      if (!batch || batch.status === '已确认') return
      if (batch.conflicts.some((conflict) => conflict.status === '待裁决')) return
      batch.attempts += 1
      if (state.simulateWriteFailure) {
        batch.status = '写入失败'
        batch.appliedLog.push(`第 ${batch.attempts} 次写入失败，已从 ${state.lastConfirmed.batchId} 恢复`)
        const restored = structuredClone(current(state).lastConfirmed.snapshot)
        state.tracks = restored.tracks
        state.comments = restored.comments
        state.hints = restored.hints
        return
      }
      batch.status = '已确认'
      const result = structuredClone(current(batch).result)
      state.tracks = result.tracks
      state.comments = result.comments
      state.hints = result.hints
      state.lastConfirmed = { batchId: batch.id, snapshot: structuredClone(result) }
      const versionId = `v${batch.revision}`
      if (!state.versions.some((version) => version.id === versionId)) {
        state.versions.unshift({ id: versionId, author: '出版批次', time: batch.createdAt, summary: `批次 ${batch.id}：${batch.appliedLog[0] ?? '离线合并'}`, trackNotes: Object.fromEntries(result.tracks.map((track) => [track.id, structuredClone(track.notes)])) })
      }
      state.dirty = false
    },

    toggleWriteFailure(state, action: PayloadAction<boolean>) { state.simulateWriteFailure = action.payload },

    /** 两名编辑同时提交评论：按到达序号先到者生效，后到者标记未生效 */
    submitCommentsRace(state, action: PayloadAction<{ measure: number; entries: { author: string; content: string; trackId?: string }[] }>) {
      action.payload.entries.forEach((entry, index) => {
        const arrival = state.commentArrivalSeq++
        const first = index === 0
        state.comments.push({
          id: `CM-${state.commentSeq++}`,
          measure: action.payload.measure,
          author: entry.author,
          content: entry.content,
          resolved: false,
          trackId: entry.trackId,
          arrival,
          status: first ? 'active' : 'superseded',
        })
      })
      state.dirty = true
    },

    /** 失效评论按当前移调重算确认 */
    revalidateComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload)
      if (comment && comment.status === 'stale') { comment.status = 'active'; comment.recalculated = true; state.dirty = true }
    },
  },
})

export const scoreApi = createApi({
  reducerPath: 'scoreApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getPublishingProfile: builder.query<{ title: string; publisher: string; pages: number; deadline: string }, void>({ queryFn: async () => ({ data: { title: '《潮汐线》室内交响作品', publisher: '云谱出版社', pages: 46, deadline: '2026-10-12' } }) }),
  }),
})

export const { selectTrack, selectNote, addNote, removeNote, updateNote, transposeTrack, undo, redo, resolveComment, saveVersion, restoreDraft, createBatch, adjudicateConflict, confirmBatch, toggleWriteFailure, submitCommentsRace, revalidateComment } = scoreSlice.actions
export const store = configureStore({ reducer: { score: scoreSlice.reducer, [scoreApi.reducerPath]: scoreApi.reducer }, middleware: (getDefault) => getDefault().concat(scoreApi.middleware) })
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
