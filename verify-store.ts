// @ts-nocheck 验证脚本：stub localStorage 后驱动真实 store
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { store, createBatch, adjudicateConflict, confirmBatch, toggleWriteFailure, submitCommentsRace, revalidateComment, selectTrack, transposeTrack } = await import('./src/store.ts')

let failures = 0
const check = (name, cond, detail = '') => { if (cond) console.log(`  ok  ${name}`); else { failures++; console.log(`FAIL  ${name} ${detail}`) } }
const state = () => store.getState().score

// 1. 合并生成批次
store.dispatch(createBatch())
let batch = state().batches[0]
check('批次已生成 PB-013 / rev 13', batch.id === 'PB-013' && batch.revision === 13 && batch.status === '待确认', `${batch.id} ${batch.revision} ${batch.status}`)
check('草稿全部已合并', state().drafts.every((d) => d.status === '已合并'))
check('无修订号旧稿升为 rev 1', state().drafts.find((d) => d.id === 'OD-097').revision === 1)

// 2. 冲突未裁决时不能写入
store.dispatch(confirmBatch('PB-013'))
check('待裁决时写入被阻止', state().batches[0].status === '待确认' && state().batches[0].attempts === 0)

// 3. 裁决两处冲突
store.dispatch(adjudicateConflict({ batchId: 'PB-013', conflictId: 'CF-M-02', keep: 'publishing' }))
store.dispatch(adjudicateConflict({ batchId: 'PB-013', conflictId: 'CF-CM-1', keep: 'rehearsal' }))
batch = state().batches[0]
check('冲突全部已裁决', batch.conflicts.every((c) => c.status === '已裁决'))

// 4. 写入失败 → 从最后确认批次 PB-000 恢复
store.dispatch(toggleWriteFailure(true))
store.dispatch(confirmBatch('PB-013'))
batch = state().batches[0]
check('写入失败', batch.status === '写入失败' && batch.attempts === 1)
check('已恢复到最后确认批次', state().tracks.find((t) => t.id === 'TR-02').transposition === -2 && state().tracks.find((t) => t.id === 'TR-01').notes[8].id.startsWith('N-'))
check('失败未生成版本', !state().versions.some((v) => v.id === 'v13'))

// 5. 按原编号重试 → 不重复生成版本
store.dispatch(toggleWriteFailure(false))
store.dispatch(confirmBatch('PB-013'))
batch = state().batches[0]
check('原编号重试成功', batch.id === 'PB-013' && batch.revision === 13 && batch.status === '已确认' && batch.attempts === 2)
check('版本恰好生成一次', state().versions.filter((v) => v.id === 'v13').length === 1)
check('恢复点推进到 PB-013', state().lastConfirmed.batchId === 'PB-013')
check('合并结果已生效', state().tracks.find((t) => t.id === 'TR-02').transposition === -1 && state().tracks.find((t) => t.id === 'TR-03').notes[4].id.startsWith('P2-'))
check('裁决评论已生效', state().comments.find((c) => c.id === 'CM-1').content.includes('pp'))

// 6. 重复确认不再生成版本
store.dispatch(confirmBatch('PB-013'))
check('重复确认幂等', state().versions.filter((v) => v.id === 'v13').length === 1 && state().batches[0].attempts === 2)

// 7. 评论并发：先到者生效
store.dispatch(submitCommentsRace({ measure: 2, entries: [{ author: '方亦', content: '先到' }, { author: '赵晴', content: '后到' }] }))
const race = state().comments.filter((c) => c.arrival !== undefined)
check('先到者生效', race[0].status === 'active' && race[0].author === '方亦')
check('后到者未生效', race[1].status === 'superseded' && race[1].arrival > race[0].arrival)

// 8. 移调 → 评论失效待重算、提示重算；重算确认后恢复
check('合并后 CM-3 已失效', state().comments.find((c) => c.id === 'CM-3').status === 'stale')
store.dispatch(revalidateComment('CM-3'))
check('评论重算确认', state().comments.find((c) => c.id === 'CM-3').status === 'active' && state().comments.find((c) => c.id === 'CM-3').recalculated)
store.dispatch(selectTrack('TR-02'))
store.dispatch(transposeTrack(1))
check('再次移调评论又失效', state().comments.find((c) => c.id === 'CM-3').status === 'stale')
check('再次移调提示已重算', state().hints.filter((h) => h.trackId === 'TR-02').every((h) => !h.stale && h.note?.includes('重算')))

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
