import { useState } from 'react'
import { Alert, Button, Card, Col, Row, Select, Space, Switch, Table, Tag, Timeline } from 'antd'
import { CloudUploadOutlined, MergeCellsOutlined, ReloadOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { adjudicateConflict, confirmBatch, createBatch, revalidateComment, submitCommentsRace, toggleWriteFailure } from '../store'
import { SOURCE_LABEL } from '../batch'
import type { MergeConflict, PublishBatch } from '../types'

const statusColor: Record<string, string> = { 待确认: 'gold', 已确认: 'green', 写入失败: 'red' }

function ConflictCard({ batch, conflict }: { batch: PublishBatch; conflict: MergeConflict }) {
  const dispatch = useDispatch<AppDispatch>()
  return <Card size="small" style={{ marginTop: 12 }} title={<span>冲突 {conflict.anchor} · {conflict.kind === 'measure' ? '同一小节' : '同一评论'}两边都改过 <Tag color={conflict.status === '待裁决' ? 'orange' : 'green'}>{conflict.status}{conflict.kept ? `：保留${SOURCE_LABEL[conflict.kept]}` : ''}</Tag></span>}>
    <Row gutter={12}>
      {conflict.sides.map((side) => <Col span={12} key={side.source}>
        <div className="panel" style={{ background: '#fafbfd' }}>
          <Tag color={side.source === 'rehearsal' ? 'blue' : 'purple'}>{SOURCE_LABEL[side.source]}</Tag>
          {side.change.kind === 'measure'
            ? <p>{side.change.trackId} 第 {conflict.anchor.replace(/^M-0?/, '')} 小节 → {side.change.notes.map((note) => `${note.key.replace('/', '')}(${note.dynamic})`).join(' ')}</p>
            : <p>{side.change.author}：{side.change.content}</p>}
          {conflict.status === '待裁决' && <Button size="small" type="primary" onClick={() => dispatch(adjudicateConflict({ batchId: batch.id, conflictId: conflict.id, keep: side.source }))}>保留{SOURCE_LABEL[side.source]}版</Button>}
        </div>
      </Col>)}
    </Row>
  </Card>
}

export default function Batches() {
  const dispatch = useDispatch<AppDispatch>()
  const { drafts, batches, hints, comments, lastConfirmed, simulateWriteFailure } = useSelector((state: RootState) => state.score)
  const [raceMeasure, setRaceMeasure] = useState(2)
  const pendingDrafts = drafts.filter((draft) => draft.status !== '已合并')
  const staleComments = comments.filter((comment) => comment.status === 'stale')
  const latestRace = comments.filter((comment) => comment.arrival !== undefined).slice(-4)

  return <main className="page">
    <div className="page-head">
      <div><p className="eyebrow">离线合并 · 裁决 · 可恢复写入</p><h1>出版批次</h1><p>排练室与出版室的离线改动按现场编号合并；冲突各留一份待裁决；移调变化让旧评论与换页提示失效重算；写入失败从最后确认批次恢复。</p></div>
      <Space>
        <span>当前恢复点 <Tag color="green">{lastConfirmed.batchId}</Tag></span>
        <Switch checked={simulateWriteFailure} onChange={(value) => dispatch(toggleWriteFailure(value))} checkedChildren="下次写入失败" unCheckedChildren="写入正常" />
        <Button type="primary" icon={<MergeCellsOutlined />} disabled={!pendingDrafts.length} onClick={() => dispatch(createBatch())}>合并 {pendingDrafts.length} 份草稿生成批次</Button>
      </Space>
    </div>

    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Card title="离线草稿箱（按现场编号合并）" size="small">
          <Table rowKey="id" pagination={false} size="small" dataSource={drafts} columns={[
            { title: '草稿', dataIndex: 'id' },
            { title: '来源', dataIndex: 'source', render: (value: string) => <Tag color={value === 'rehearsal' ? 'blue' : 'purple'}>{SOURCE_LABEL[value]}</Tag> },
            { title: '作者', dataIndex: 'author' },
            { title: '修订号', dataIndex: 'revision', render: (value: number | null, row) => value === null && row.status === '待收录' ? <Tag color="orange">无修订号 → 升首版待确认</Tag> : <Tag>{`rev ${value ?? 1}`}</Tag> },
            { title: '改动锚点', render: (_value, row) => row.changes.map((change) => <Tag key={change.anchor}>{change.anchor}</Tag>) },
            { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === '已合并' ? 'green' : 'gold'}>{value}</Tag> },
          ]} />
        </Card>

        {batches.map((batch) => <Card key={batch.id} size="small" style={{ marginTop: 16 }} title={<Space><b>{batch.id}</b><Tag>修订号 rev {batch.revision}</Tag><Tag color={statusColor[batch.status]}>{batch.status}</Tag><span className="muted">写入 {batch.attempts} 次 · 来源 {batch.sourceDrafts.join('、')}</span></Space>} extra={<Space>
          {batch.status !== '已确认' && <Button size="small" type="primary" icon={batch.status === '写入失败' ? <ReloadOutlined /> : <CloudUploadOutlined />} disabled={batch.conflicts.some((conflict) => conflict.status === '待裁决')} onClick={() => dispatch(confirmBatch(batch.id))}>{batch.status === '写入失败' ? `按原编号 ${batch.id} 重试` : '确认写入'}</Button>}
        </Space>}>
          {batch.promotions.map((note) => <Alert key={note} style={{ marginBottom: 8 }} type="info" showIcon message={note} />)}
          {batch.invalidations.map((note) => <Alert key={note} style={{ marginBottom: 8 }} type="warning" showIcon message={`移调失效重算：${note}`} />)}
          {batch.conflicts.map((conflict) => <ConflictCard key={conflict.id} batch={batch} conflict={conflict} />)}
          <Timeline style={{ marginTop: 14 }} items={batch.appliedLog.map((log) => ({ children: log }))} />
        </Card>)}
      </Col>

      <Col xs={24} xl={10}>
        <Card title="评论并发提交（先到者生效）" size="small">
          <Space wrap style={{ marginBottom: 12 }}>
            <span>目标小节</span>
            <Select value={raceMeasure} style={{ width: 110 }} options={[1, 2, 3].map((value) => ({ value, label: `第 ${value} 小节` }))} onChange={setRaceMeasure} />
            <Button onClick={() => dispatch(submitCommentsRace({ measure: raceMeasure, entries: [
              { author: '指挥 · 方亦', content: `第 ${raceMeasure} 小节力度再弱一级（先到生效）`, trackId: 'TR-03' },
              { author: '出版 · 赵晴', content: `第 ${raceMeasure} 小节维持现状（后到未生效）`, trackId: 'TR-03' },
            ] }))}>模拟两人同时提交</Button>
          </Space>
          {latestRace.map((comment) => <div key={comment.id} className="diff-row" style={{ gridTemplateColumns: '90px 1fr auto' }}>
            <Tag>{comment.id} · #{comment.arrival}</Tag>
            <span>{comment.author}：{comment.content}</span>
            <Tag color={comment.status === 'superseded' ? 'default' : 'green'}>{comment.status === 'superseded' ? '后到未生效' : '已生效'}</Tag>
          </div>)}
        </Card>

        <Card title="移调失效 · 待重算评论" size="small" style={{ marginTop: 16 }}>
          {!staleComments.length && <Alert type="success" showIcon message="没有失效评论" />}
          {staleComments.map((comment) => <div key={comment.id} className="diff-row" style={{ gridTemplateColumns: '90px 1fr auto' }}>
            <Tag color="orange">第 {comment.measure} 小节</Tag>
            <span>{comment.author}：{comment.content}</span>
            <Button size="small" onClick={() => dispatch(revalidateComment(comment.id))}>按当前移调重算</Button>
          </div>)}
          {comments.filter((comment) => comment.recalculated).map((comment) => <div key={comment.id} className="diff-row" style={{ gridTemplateColumns: '90px 1fr auto' }}>
            <Tag color="green">第 {comment.measure} 小节</Tag><span>{comment.content}</span><Tag color="green">已重算</Tag>
          </div>)}
        </Card>

        <Card title="分谱换页提示（移调后自动重算）" size="small" style={{ marginTop: 16 }}>
          <Table rowKey="id" pagination={false} size="small" dataSource={hints} columns={[
            { title: '编号', dataIndex: 'id' },
            { title: '声部', dataIndex: 'trackId' },
            { title: '换页点', render: (_value, row) => (row.beforeMeasure ? `第 ${row.beforeMeasure} 小节前` : '无需换页') },
            { title: '提示音', render: (_value, row) => (row.cueMeasures ? `${row.cueMeasures} 小节` : '—') },
            { title: '状态', render: (_value, row) => row.stale ? <Tag color="orange">失效待重算</Tag> : <Tag color="green">{row.note ?? '有效'}</Tag> },
          ]} />
        </Card>
      </Col>
    </Row>
  </main>
}
