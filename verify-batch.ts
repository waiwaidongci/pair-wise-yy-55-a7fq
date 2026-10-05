import { mergeDrafts, applyMeasureChange, recomputeHintsForTrack } from './src/batch'
import { seedComments, seedDrafts, seedHints, seedTracks } from './src/mock'
import type { BatchResult } from './src/types'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`)
  else { failures++; console.log(`FAIL  ${name} ${detail}`) }
}

const baseResult: BatchResult = { tracks: structuredClone(seedTracks), comments: structuredClone(seedComments), hints: structuredClone(seedHints) }

// 1. 合并三份草稿
const batch = mergeDrafts(baseResult, structuredClone(seedDrafts), { id: 'PB-013', revision: 13, createdAt: '18:00' })

// 同一小节 M-02 与同一评论 CM-1 两边都改过 → 各留一份待裁决
check('两个冲突待裁决', batch.conflicts.length === 2 && batch.conflicts.every((c) => c.status === '待裁决'), JSON.stringify(batch.conflicts.map((c) => c.anchor)))
check('冲突各留一份', batch.conflicts.every((c) => c.sides.length === 2 && c.sides[0].source !== c.sides[1].source))
// 冲突锚点的基线值保持生效（TR-03 第 2 小节仍是旧音）
const tr03 = batch.result.tracks.find((t) => t.id === 'TR-03')!
check('冲突小节基线不动', tr03.notes[4]!.id.startsWith('N-'), tr03.notes[4]!.id)
check('冲突评论基线不动', batch.result.comments.find((c) => c.id === 'CM-1')!.content.includes('再弱一级'))

// 单边改动直接合并：M-03 长笛、M-01 大提琴（旧稿）
const tr01 = batch.result.tracks.find((t) => t.id === 'TR-01')!
check('单边小节已合并 M-03', tr01.notes[8]!.id.startsWith('P3-'), tr01.notes[8]!.id)
const tr04 = batch.result.tracks.find((t) => t.id === 'TR-04')!
check('旧稿小节已合并 M-01', tr04.notes[0]!.id.startsWith('R1-'), tr04.notes[0]!.id)

// 无修订号旧稿升首版待确认
check('旧稿升首版待确认', batch.promotions.length === 1 && batch.promotions[0]!.includes('OD-097') && batch.promotions[0]!.includes('首版待确认'))

// 移调 TR-02 -2 → -1：音符上移、评论失效、换页提示重算
const tr02 = batch.result.tracks.find((t) => t.id === 'TR-02')!
check('移调已生效', tr02.transposition === -1 && tr02.notes[0]!.key === 'd#/4', `${tr02.transposition} ${tr02.notes[0]!.key}`)
check('旧评论失效待重算', batch.result.comments.find((c) => c.id === 'CM-3')!.status === 'stale')
check('换页提示已重算', batch.result.hints.filter((h) => h.trackId === 'TR-02').every((h) => !h.stale && h.note?.includes('重算')))
check('失效有记录', batch.invalidations.some((i) => i.includes('CM-3')) && batch.invalidations.some((i) => i.includes('PB-TR-02')))

// 单边换页提示改动被移调重算覆盖（TR-02 的提示音按新移调重算）
check('移调后提示音重算', batch.result.hints.find((h) => h.trackId === 'TR-02')!.cueMeasures === 2)

// 2. 裁决：保留出版室版 M-02
const conflict = batch.conflicts.find((c) => c.anchor === 'M-02')!
const kept = conflict.sides.find((s) => s.source === 'publishing')!
batch.result.tracks = applyMeasureChange(batch.result.tracks, kept.change as never)
const tr03After = batch.result.tracks.find((t) => t.id === 'TR-03')!
check('裁决后采用出版室小节', tr03After.notes[4]!.id.startsWith('P2-'), tr03After.notes[4]!.id)

// 3. 换页重算规则：移调乐器每页 4 小节
const hints = recomputeHintsForTrack({ ...tr03, transposition: -7 }, seedHints)
check('移调声部换页点重算', hints.find((h) => h.trackId === 'TR-03')!.beforeMeasure === 5, JSON.stringify(hints.filter((h) => h.trackId === 'TR-03')))

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
