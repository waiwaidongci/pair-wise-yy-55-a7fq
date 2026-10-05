import { configureStore, createAsyncThunk, createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import type { MergeConflict, OfflineChange, PartLayout, PublishingBatch, ScoreComment, ScoreNote, Track } from './types'
import { seedComments, seedParts, seedTracks, seedVersions } from './mock'
import { __resetServer, getLastConfirmed, submitBatch, submitComment, __setFailMode } from './server'

const DRAFT_KEY = 'yy55-score-draft'

interface ScoreState {
  tracks: Track[]
  selectedTrackId: string
  selectedNoteIndex: number
  history: string[]
  future: string[]
  comments: ScoreComment[]
  versions: typeof seedVersions
  parts: PartLayout[]
  batches: PublishingBatch[]
  conflicts: MergeConflict[]
  /** 服务器最后确认的修订号 */
  headRevision: number
  /** 旧稿无修订号，已升成首版待确认 */
  legacyDraft: boolean
  dirty: boolean
  writeState: 'idle' | 'writing' | 'failed'
  writeLog: string[]
}

function deepEqual(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b) }

function persist(state: ScoreState) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    tracks: state.tracks, comments: state.comments, parts: state.parts,
    revision: state.headRevision,
  }))
}

function loadInitial(): Pick<ScoreState, 'tracks' | 'comments' | 'parts' | 'batches' | 'headRevision' | 'legacyDraft'> {
  const fallback = { tracks: structuredClone(seedTracks), comments: structuredClone(seedComments), parts: structuredClone(seedParts), batches: [], headRevision: 0, legacyDraft: false }
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return fallback
    const draft = JSON.parse(raw)
    const tracks: Track[] = draft.tracks ?? fallback.tracks
    const comments: ScoreComment[] = draft.comments ?? fallback.comments
    const parts: PartLayout[] = draft.parts ?? structuredClone(seedParts)
    // 旧稿无修订号：升成首版待确认，而不是直接当成已确认版本
    if (draft.revision == null) {
      const batch: PublishingBatch = {
        id: 'B-001', revision: 1, status: 'pending', baseRevision: 0,
        author: '当前用户', time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        summary: '旧稿升级为首版，待确认',
        tracks: structuredClone(tracks), comments: structuredClone(comments), parts: structuredClone(parts), conflicts: [],
      }
      return { tracks, comments, parts, batches: [batch], headRevision: 0, legacyDraft: true }
    }
    return { tracks, comments, parts, batches: [], headRevision: Number(draft.revision) || 0, legacyDraft: false }
  } catch {
    return fallback
  }
}

__resetServer({ tracks: seedTracks, comments: seedComments, parts: seedParts })
const loaded = loadInitial()

const initialState: ScoreState = {
  tracks: loaded.tracks,
  selectedTrackId: 'TR-01', selectedNoteIndex: 2, history: [], future: [],
  comments: loaded.comments,
  versions: structuredClone(seedVersions),
  parts: loaded.parts,
  batches: loaded.batches,
  conflicts: [],
  headRevision: loaded.headRevision,
  legacyDraft: loaded.legacyDraft,
  dirty: false,
  writeState: 'idle',
  writeLog: [],
}

function snapshot(state: ScoreState) {
  state.history.push(JSON.stringify(state.tracks)); if (state.history.length > 40) state.history.shift(); state.future = []; state.dirty = true
  persist(state)
}

function transposeKey(key: string, semitones: number) {
  const chromatic = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b']
  const [pitch, octaveText] = key.split('/')
  let index = chromatic.indexOf(pitch!.replace('b', '')) + semitones
  let octave = Number(octaveText)
  while (index < 0) { index += 12; octave -= 1 }
  while (index >= 12) { index -= 12; octave += 1 }
  return `${chromatic[index]}/${octave}`
}

/** 移调后旧评论锚点与分谱换页提示失效，需要重算 */
function invalidateAfterTranspose(state: ScoreState, trackId: string, semitones: number) {
  state.comments.forEach((comment) => {
    if (!comment.trackId || comment.trackId === trackId) comment.stale = true
  })
  const part = state.parts.find((item) => item.trackId === trackId)
  if (part) {
    part.stale = true
    part.reason = `移调 ${semitones > 0 ? '+' : ''}${semitones} 后换页提示失效，需重算`
  }
}

function applyOfflineChange(state: ScoreState, change: OfflineChange) {
  if (change.kind === 'measure') {
    const [trackId, measureText] = change.entityId.split(':')
    const measureNo = Number(measureText.replace('M', ''))
    const track = state.tracks.find((item) => item.id === trackId)
    if (!track) return
    const after = change.after as ScoreNote[]
    track.notes.splice((measureNo - 1) * 4, 4, ...after)
  } else {
    const after = change.after as ScoreComment
    const index = state.comments.findIndex((item) => item.id === change.entityId)
    if (index >= 0) state.comments[index] = after
    else state.comments.push(after)
  }
}

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
      track.notes.forEach((note) => { note.key = transposeKey(note.key, action.payload) })
      track.transposition += action.payload
      invalidateAfterTranspose(state, track.id, action.payload)
    },
    undo(state) { const previous = state.history.pop(); if (!previous) return; state.future.push(JSON.stringify(state.tracks)); state.tracks = JSON.parse(previous); state.dirty = true },
    redo(state) { const next = state.future.pop(); if (!next) return; state.history.push(JSON.stringify(state.tracks)); state.tracks = JSON.parse(next); state.dirty = true },
    resolveComment(state, action: PayloadAction<string>) { const comment = state.comments.find((item) => item.id === action.payload); if (comment) comment.resolved = true; state.dirty = true },
    addComment(state, action: PayloadAction<ScoreComment>) { state.comments.push(action.payload); state.dirty = true; persist(state) },
    saveVersion(state) {
      const revision = state.headRevision + 1
      state.versions.unshift({ id: `v${revision}`, author: '当前用户', time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), summary: '保存当前总谱与分谱调整', trackNotes: Object.fromEntries(state.tracks.map((track) => [track.id, structuredClone(track.notes)])), revision })
      state.dirty = false; localStorage.removeItem(DRAFT_KEY)
    },
    restoreDraft(state) {
      const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return
      const draft = JSON.parse(raw)
      state.tracks = draft.tracks; state.comments = draft.comments; state.parts = draft.parts ?? state.parts
      state.headRevision = draft.revision ?? state.headRevision
      state.dirty = true
    },
    /** 离线改动按现场编号合并：单边改动直接吸收，两边都改则各留一份待裁决 */
    mergeOfflineChanges(state, action: PayloadAction<{ local: OfflineChange[]; remote: OfflineChange[] }>) {
      const groups = new Map<string, { local?: OfflineChange; remote?: OfflineChange }>()
      for (const change of action.payload.local) {
        const group = groups.get(change.entityId) ?? {}
        group.local = change
        groups.set(change.entityId, group)
      }
      for (const change of action.payload.remote) {
        const group = groups.get(change.entityId) ?? {}
        group.remote = change
        groups.set(change.entityId, group)
      }
      for (const [entityId, group] of groups) {
        if (group.local && !group.remote) { applyOfflineChange(state, group.local) }
        else if (!group.local && group.remote) { applyOfflineChange(state, group.remote) }
        else if (group.local && group.remote) {
          if (deepEqual(group.local.after, group.remote.after)) applyOfflineChange(state, group.local)
          else state.conflicts.push({
            id: `CF-${nanoid(6)}`, kind: group.local.kind, entityId,
            sceneNo: `${group.local.sceneNo} / ${group.remote.sceneNo}`,
            local: group.local.after, remote: group.remote.after, status: 'pending',
          })
        }
      }
      state.dirty = true
      persist(state)
    },
    /** 裁决冲突：采用某一边的版本 */
    adjudicateConflict(state, action: PayloadAction<{ id: string; side: 'local' | 'remote' }>) {
      const conflict = state.conflicts.find((item) => item.id === action.payload.id)
      if (!conflict || conflict.status !== 'pending') return
      const change: OfflineChange = {
        sceneNo: conflict.sceneNo, baseRevision: state.headRevision, kind: conflict.kind,
        entityId: conflict.entityId, after: action.payload.side === 'local' ? conflict.local : conflict.remote,
      }
      applyOfflineChange(state, change)
      conflict.status = 'accepted'
      conflict.acceptedSide = action.payload.side
      state.dirty = true
      persist(state)
    },
    /** 移调后重算分谱换页提示 */
    recalcPart(state, action: PayloadAction<string>) {
      const part = state.parts.find((item) => item.trackId === action.payload)
      if (!part) return
      const track = state.tracks.find((item) => item.id === part.trackId)!
      part.pageTurnMeasure = Math.max(1, Math.round(track.notes.length / 4) - 1)
      part.cueMeasure = 2
      part.stale = false
      part.reason = undefined
      state.dirty = true
      persist(state)
    },
    /** 移调后重新锚定全部评论 */
    reanchorComments(state) {
      state.comments.forEach((comment) => { comment.stale = false })
      state.dirty = true
      persist(state)
    },
    /** 写入失败后从最后确认批次恢复 */
    recoverFromConfirmed(state) {
      const last = getLastConfirmed()
      state.tracks = structuredClone(last.tracks)
      state.comments = structuredClone(last.comments)
      state.parts = structuredClone(last.parts)
      state.conflicts = structuredClone(last.conflicts)
      state.batches = state.batches.map((batch) => batch.id === last.id ? { ...batch, status: 'confirmed', revision: last.revision } : batch)
      state.headRevision = last.revision
      state.dirty = false
      state.writeState = 'idle'
      state.writeLog.unshift(`${new Date().toLocaleTimeString('zh-CN')} 写入失败，已从最后确认批次 ${last.id}（v${last.revision}）恢复`)
    },
    batchSubmitted(state, action: PayloadAction<PublishingBatch>) {
      state.batches.unshift(action.payload)
      state.writeState = 'writing'
    },
    batchConfirmed(state, action: PayloadAction<{ batch: PublishingBatch; revision: number }>) {
      const { batch, revision } = action.payload
      state.batches = state.batches.map((item) => item.id === batch.id ? { ...item, status: 'confirmed', revision } : item)
      state.versions.unshift({
        id: `v${revision}`, author: batch.author, time: batch.time,
        summary: batch.summary, trackNotes: Object.fromEntries(batch.tracks.map((track) => [track.id, structuredClone(track.notes)])), revision,
      })
      state.headRevision = revision
      state.dirty = false
      state.writeState = 'idle'
      state.legacyDraft = false
      localStorage.removeItem(DRAFT_KEY)
      state.writeLog.unshift(`${new Date().toLocaleTimeString('zh-CN')} 批次 ${batch.id} 已确认，修订号 v${revision}`)
    },
    commentCommitted(state, action: PayloadAction<{ comment: ScoreComment; revision: number; duplicate?: boolean }>) {
      const exists = state.comments.some((item) => item.id === action.payload.comment.id)
      if (!exists) state.comments.push(action.payload.comment)
      state.headRevision = action.payload.revision
      state.dirty = false
      state.writeState = 'idle'
      persist(state)
      state.writeLog.unshift(action.payload.duplicate
        ? `${new Date().toLocaleTimeString('zh-CN')} 评论 ${action.payload.comment.id} 幂等命中，未重复生成版本`
        : `${new Date().toLocaleTimeString('zh-CN')} 评论 ${action.payload.comment.id} 已提交（v${action.payload.revision}）`)
    },
    writeFailed(state, action: PayloadAction<{ error: string; phase: string }>) {
      state.writeState = 'failed'
      state.writeLog.unshift(`${new Date().toLocaleTimeString('zh-CN')} ${action.payload.phase}写入失败：${action.payload.error}`)
    },
    dismissLegacyDraft(state) { state.legacyDraft = false },
  },
})

/** 形成出版批次：写入失败则从最后确认批次恢复，按原编号重试且不重复生成版本 */
export const publishBatch = createAsyncThunk<void, void, { state: { score: ScoreState } }>(
  'score/publishBatch',
  async (_arg, { getState, dispatch }) => {
    const state = getState().score
    const batch: PublishingBatch = {
      id: `B-${String(state.headRevision + 1).padStart(3, '0')}`,
      revision: state.headRevision + 1,
      status: 'pending',
      baseRevision: state.headRevision,
      author: '当前用户',
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      summary: '确认出版批次：总谱、移调、评论与分谱排版',
      tracks: structuredClone(state.tracks),
      comments: structuredClone(state.comments),
      parts: structuredClone(state.parts),
      conflicts: structuredClone(state.conflicts),
      idempotencyKey: `batch:${state.headRevision + 1}`,
    }
    dispatch(batchSubmitted(batch))
    let result = submitBatch(batch)
    if (!result.ok) {
      dispatch(writeFailed({ error: result.error ?? 'WRITE_FAILED', phase: '批次首次' }))
      dispatch(recoverFromConfirmed())
      // 按原编号重试：幂等键不变，已生效则直接返回，不重复生成版本
      result = submitBatch(batch)
    }
    if (result.ok) dispatch(batchConfirmed({ batch, revision: result.revision! }))
    else dispatch(writeFailed({ error: result.error ?? 'WRITE_FAILED', phase: '批次重试' }))
  },
)

/** 评论提交：先到者生效；写入失败先恢复，再按原编号重试 */
export const submitCommentWithRecovery = createAsyncThunk<void, ScoreComment, { state: { score: ScoreState } }>(
  'score/submitComment',
  async (comment, { getState, dispatch }) => {
    const readHead = () => getState().score.headRevision
    let result = submitComment(comment, readHead())
    if (!result.ok) {
      dispatch(writeFailed({ error: result.error ?? 'WRITE_FAILED', phase: '评论首次' }))
      dispatch(recoverFromConfirmed())
      // 恢复后基线可能已被先到者推进，按原编号（同一评论 id）重试
      result = submitComment(comment, readHead())
      if (!result.ok) {
        dispatch(recoverFromConfirmed())
        result = submitComment(comment, readHead())
      }
    }
    if (result.ok) dispatch(commentCommitted({ comment, revision: result.revision!, duplicate: result.duplicate }))
    else dispatch(writeFailed({ error: result.error ?? 'WRITE_FAILED', phase: '评论重试' }))
  },
)

/** 演示：两名编辑同时提交评论，先到者生效，后到者恢复后按原编号重试 */
export const simulateConcurrentComments = createAsyncThunk<void, void, { state: { score: ScoreState } }>(
  'score/concurrentComments',
  async (_arg, { dispatch }) => {
    const cA: ScoreComment = {
      id: `CM-${nanoid(6)}`, measure: 4, author: '作曲 · 沈青',
      content: '【并发甲】第 4 小节表情统一为 cantabile，分谱同步。', resolved: false, sceneNo: 'SC-出版-2',
    }
    const cB: ScoreComment = {
      id: `CM-${nanoid(6)}`, measure: 5, author: '指挥 · 方亦',
      content: '【并发乙】第 5 小节速度保持 ♩=72，不要渐快。', resolved: false, sceneNo: 'SC-排练-3',
    }
    await Promise.all([
      dispatch(submitCommentWithRecovery(cA)),
      dispatch(submitCommentWithRecovery(cB)),
    ])
  },
)

/** 演示：排练室与出版室离线改动按现场编号合并，冲突各留一份待裁决 */
export const simulateOfflineMerge = createAsyncThunk<void, void, { state: { score: ScoreState } }>(
  'score/simulateOfflineMerge',
  async (_arg, { getState, dispatch }) => {
    const state = getState().score
    const horn = state.tracks.find((item) => item.id === 'TR-03')!
    const baseMeasure = horn.notes.slice(4, 8)
    const localMeasure = baseMeasure.map((note) => ({ ...note, dynamic: 'p' as const }))
    const remoteMeasure = baseMeasure.map((note) => ({ ...note, dynamic: 'f' as const }))
    const cm1 = state.comments.find((item) => item.id === 'CM-1')!
    const localComment: ScoreComment = { ...cm1, content: '【排练室 · 现场修订】圆号第 2 小节改为 p，并加渐弱至 mp。', sceneNo: 'SC-排练-3' }
    const remoteComment: ScoreComment = { ...cm1, resolved: true, sceneNo: 'SC-出版-2' }
    const newComment: ScoreComment = {
      id: 'CM-4', measure: 2, trackId: 'TR-03', author: '排练 · 现场记录',
      content: '圆号进入前建议加吸气提示。', resolved: false, sceneNo: 'SC-排练-3',
    }
    dispatch(mergeOfflineChanges({
      local: [
        { sceneNo: 'SC-排练-3', baseRevision: state.headRevision, kind: 'measure', entityId: 'TR-03:M2', after: localMeasure },
        { sceneNo: 'SC-排练-3', baseRevision: state.headRevision, kind: 'comment', entityId: 'CM-1', after: localComment },
        { sceneNo: 'SC-排练-3', baseRevision: state.headRevision, kind: 'comment', entityId: 'CM-4', after: newComment },
      ],
      remote: [
        { sceneNo: 'SC-出版-2', baseRevision: state.headRevision, kind: 'measure', entityId: 'TR-03:M2', after: remoteMeasure },
        { sceneNo: 'SC-出版-2', baseRevision: state.headRevision, kind: 'comment', entityId: 'CM-1', after: remoteComment },
      ],
    }))
  },
)

export const scoreApi = createApi({
  reducerPath: 'scoreApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getPublishingProfile: builder.query<{ title: string; publisher: string; pages: number; deadline: string }, void>({ queryFn: async () => ({ data: { title: '《潮汐线》室内交响作品', publisher: '云谱出版社', pages: 46, deadline: '2026-10-12' } }) }),
  }),
})

export const {
  selectTrack, selectNote, addNote, removeNote, updateNote, transposeTrack, undo, redo,
  resolveComment, addComment, saveVersion, restoreDraft,
  mergeOfflineChanges, adjudicateConflict, recalcPart, reanchorComments, recoverFromConfirmed,
  batchSubmitted, batchConfirmed, commentCommitted, writeFailed, dismissLegacyDraft,
} = scoreSlice.actions
export { __setFailMode }
export const store = configureStore({ reducer: { score: scoreSlice.reducer, [scoreApi.reducerPath]: scoreApi.reducer }, middleware: (getDefault) => getDefault().concat(scoreApi.middleware) })
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
