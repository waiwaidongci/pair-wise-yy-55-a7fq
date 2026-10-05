import { Card, Button, Tag, Tabs, Timeline, Alert, Table, Space, Descriptions, Empty } from 'antd'
import { CheckOutlined, CloseOutlined, CommentOutlined, CloudUploadOutlined, ReloadOutlined, MergeCellsOutlined, ThunderboltOutlined, HistoryOutlined } from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import {
  resolveComment, adjudicateConflict, publishBatch, recoverFromConfirmed,
  simulateConcurrentComments, simulateOfflineMerge, __setFailMode,
} from '../store'

export default function Versions() {
  const dispatch = useDispatch<AppDispatch>()
  const { versions, comments, batches, conflicts, headRevision, legacyDraft, writeState, writeLog } = useSelector((state: RootState) => state.score)
  const pendingConflicts = conflicts.filter((item) => item.status === 'pending')
  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">版本、评论与出版基线</p><h1>差异比较与审阅</h1><p>总谱、移调、评论与分谱排版结成可恢复的出版批次；离线改动按现场编号合并，冲突各留一份待裁决。</p></div><Space wrap>
      <Button icon={<ReloadOutlined />} onClick={() => dispatch(recoverFromConfirmed())}>从最后确认批次恢复</Button>
      <Button type="primary" icon={<CloudUploadOutlined />} loading={writeState === 'writing'} onClick={() => dispatch(publishBatch())}>确认出版批次</Button>
    </Space></div>
    {legacyDraft && <Alert type="warning" showIcon style={{ marginBottom: 14 }} message="检测到旧稿无修订号，已升级为首版待确认批次" description="本地草稿未携带修订号，已按首版（v1）待确认批次管理；确认后才会成为可恢复的出版基线。" />}
    {pendingConflicts.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 14 }} message={`${pendingConflicts.length} 项合并冲突待裁决`} description="同一小节或评论两边都改过，已各留一份。请选择采用排练室还是出版室版本，裁决后才会进入出版批次。" />}
    <Tabs items={[
      { key: 'batches', label: `出版批次${pendingConflicts.length ? ` (${pendingConflicts.length} 冲突)` : ''}`, children: <>
        <div className="panel" style={{ marginBottom: 14 }}>
          <Space wrap>
            <Button icon={<MergeCellsOutlined />} onClick={() => dispatch(simulateOfflineMerge())}>模拟排练室 / 出版室离线合并</Button>
            <Button icon={<ThunderboltOutlined />} onClick={() => dispatch(simulateConcurrentComments())}>模拟两名编辑同时提交评论</Button>
            <Button danger onClick={() => { __setFailMode('once'); dispatch(publishBatch()) }}>模拟写入失败后重试</Button>
          </Space>
          <p className="muted" style={{ margin: '10px 0 0' }}>离线改动带现场编号（如 SC-排练-3 / SC-出版-2）合并；同小节两边都改则各留一份待裁决。评论并发提交先到者生效，写入失败从最后确认批次恢复，按原编号重试且不重复生成版本。</p>
        </div>
        <Card title="批次台账" style={{ marginBottom: 14 }}>
          <Table rowKey="id" pagination={false} dataSource={[...batches].sort((a, b) => b.revision - a.revision)} columns={[
            { title: '批次号', dataIndex: 'id', render: (value: string) => <b>{value}</b> },
            { title: '修订号', dataIndex: 'revision', render: (value: number) => <Tag color="blue">v{value}</Tag> },
            { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'confirmed' ? 'green' : value === 'pending' ? 'orange' : 'default'}>{value === 'confirmed' ? '已确认' : value === 'pending' ? '待确认' : '草稿'}</Tag> },
            { title: '基线', dataIndex: 'baseRevision', render: (value: number) => value ? `基于 v${value}` : '—' },
            { title: '作者', dataIndex: 'author' },
            { title: '时间', dataIndex: 'time' },
            { title: '摘要', dataIndex: 'summary' },
          ]} />
          {!batches.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无批次，点击右上角「确认出版批次」生成首个可恢复批次" />}
        </Card>
        <Card title="合并冲突裁决" style={{ marginBottom: 14 }}>
          {!conflicts.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无冲突" />}
          {conflicts.map((conflict) => <Card key={conflict.id} size="small" type={conflict.status === 'pending' ? 'inner' : undefined} title={<Space><Tag color="red">待裁决</Tag><span>{conflict.kind === 'measure' ? '小节' : '评论'} {conflict.entityId}</span><Tag>{conflict.sceneNo}</Tag>{conflict.status === 'accepted' && <Tag color="green">已采用 {conflict.acceptedSide === 'local' ? '排练室' : '出版室'} 版本</Tag>}</Space>} style={{ marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {([
                { side: 'local' as const, label: '排练室版本', color: 'blue', data: conflict.local },
                { side: 'remote' as const, label: '出版室版本', color: 'purple', data: conflict.remote },
              ]).map((option) => <div key={option.side} className="panel" style={{ margin: 0, borderColor: conflict.acceptedSide === option.side ? '#52c41a' : undefined }}>
                <Space style={{ marginBottom: 8 }}><Tag color={option.color}>{option.label}</Tag></Space>
                {conflict.kind === 'measure'
                  ? <Descriptions size="small" column={1} items={[
                      { key: 'notes', label: '音符', children: (option.data as { key: string }[]).map((note) => note.key.replace('/', '')).join(' · ') },
                      { key: 'dynamic', label: '力度', children: <Tag>{(option.data as { dynamic: string }[])[0]?.dynamic}</Tag> },
                    ]} />
                  : <Descriptions size="small" column={1} items={[
                      { key: 'author', label: '作者', children: (option.data as { author: string }).author },
                      { key: 'content', label: '内容', children: (option.data as { content: string }).content },
                      { key: 'resolved', label: '状态', children: (option.data as { resolved: boolean }).resolved ? <Tag color="green">已解决</Tag> : <Tag>未解决</Tag> },
                    ]} />
                }
                <Button size="small" type={conflict.acceptedSide === option.side ? 'primary' : 'default'} icon={<CheckOutlined />} disabled={conflict.status !== 'pending'} onClick={() => dispatch(adjudicateConflict({ id: conflict.id, side: option.side }))}>采用此份</Button>
              </div>)}
            </div>
          </Card>)}
        </Card>
        <Card title="写入与恢复日志"><Timeline items={writeLog.length ? writeLog.map((line) => ({ color: line.includes('失败') ? 'red' : line.includes('恢复') ? 'orange' : 'green', children: line })) : [{ color: 'gray', children: '暂无写入记录' }]} /></Card>
      </> },
      { key: 'diff', label: '版本差异', children: <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>{versions.slice(0, 2).map((version) => <Card key={version.id} title={<span>{version.id} · {version.author} {version.revision && <Tag color="blue">v{version.revision}</Tag>} <Tag>{version.time}</Tag></span>}><p>{version.summary}</p>{Object.entries(version.trackNotes).map(([trackId, notes]) => <div className="diff-row" key={trackId}><Tag color="red">修改</Tag><span>{trackId}：力度由 mp 调整为 p，增加第 3 拍延音线</span><b>{notes.length} 个音符</b></div>)}<div className="diff-row"><Tag color="green">新增</Tag><span>换页处增加同声部提示音</span><b>2 小节</b></div></Card>)}</div> },
      { key: 'comments', label: `评论锚点 (${comments.filter((item) => !item.resolved).length}${comments.filter((item) => item.stale).length ? ` · ${comments.filter((item) => item.stale).length} 失效` : ''})`, children: <div style={{ display: 'grid', gridTemplateColumns: '1.3fr .7fr', gap: 16 }}><Card>{comments.map((comment) => <div key={comment.id} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', gap: 12, padding: '14px 0', borderBottom: '1px solid #edf0f5' }}><Tag icon={<CommentOutlined />}>第 {comment.measure} 小节</Tag><div><b>{comment.author}</b>{comment.sceneNo && <Tag style={{ marginLeft: 8 }}>{comment.sceneNo}</Tag>}{comment.stale && <Tag color="orange" style={{ marginLeft: 8 }}>移调失效 · 待重算</Tag>}<p>{comment.content}</p></div><div>{comment.resolved ? <Tag color="green">已解决</Tag> : <Button size="small" onClick={() => dispatch(resolveComment(comment.id))}>应用评论</Button>}</div></div>)}</Card><Card title="待决事项"><Alert type="warning" showIcon message="第 2 小节力度仍未统一" description="接受评论后会更新圆号分谱，但不会覆盖原始版本。" /><div style={{ display: 'flex', gap: 8, marginTop: 14 }}><Button type="primary" icon={<CheckOutlined />}>接受全部</Button><Button danger icon={<CloseOutlined />}>拒绝修改</Button></div></Card></div> },
      { key: 'timeline', label: '操作历史', children: <Card><Timeline items={[{ color: 'green', children: '16:28 沈青提交 v12：调整终段和声与连音线' }, { color: 'blue', children: '15:40 方亦修改圆号力度，生成本地草稿' }, { color: 'gray', children: '14:10 发布 v11：单簧管移调分谱' }]} /></Card> },
    ]} />
    <p className="muted" style={{ marginTop: 12 }}><HistoryOutlined /> 当前最后确认修订号：{headRevision ? `v${headRevision}` : '无（旧稿已升级为首版待确认）'}</p>
  </main>
}
