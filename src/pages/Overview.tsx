import { Alert, Button, Card, Col, Progress, Row, Table, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { scoreApi } from '../store'

export default function Overview() {
  const navigate = useNavigate()
  const tracks = useSelector((state: RootState) => state.score.tracks)
  const comments = useSelector((state: RootState) => state.score.comments)
  const batches = useSelector((state: RootState) => state.score.batches)
  const drafts = useSelector((state: RootState) => state.score.drafts)
  const { data } = scoreApi.endpoints.getPublishingProfile.useQuery()
  const pendingConflicts = batches.reduce((sum, batch) => sum + batch.conflicts.filter((conflict) => conflict.status === '待裁决').length, 0)
  const staleCount = comments.filter((item) => item.status === 'stale').length
  const pendingDrafts = drafts.filter((draft) => draft.status !== '已合并').length
  return <main className="page">
    <div className="page-head"><div><p className="eyebrow">乐谱、移调与出版准备</p><h1>{data?.title ?? '总谱出版工作台'}</h1><p>统一管理多声部总谱、移调乐器分谱、换页提示、版本差异与评论锚点。</p></div><Button type="primary" onClick={() => navigate('/score')}>进入总谱编辑</Button></div>
    <Row gutter={[14,14]} className="metrics"><Col xs={24} sm={12} xl={6}><Card className="metric"><span>声部数量</span><strong>{tracks.length}</strong><small>4 个乐手分谱</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>总谱小节</span><strong>12</strong><small>4/4 拍 · C 大调</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>待处理评论</span><strong>{comments.filter((item) => !item.resolved).length}</strong><small>指挥与作曲意见</small></Card></Col><Col xs={24} sm={12} xl={6}><Card className="metric"><span>预计页数</span><strong>{data?.pages ?? 46}</strong><small>交付 {data?.deadline ?? '2026-10-12'}</small></Card></Col></Row>
    <Alert type="warning" showIcon message="出版批次待处理" description={`${pendingDrafts} 份离线草稿待合并；${pendingConflicts} 处冲突待裁决；${staleCount} 条评论因移调失效待重算。`} action={<Button size="small" onClick={() => navigate('/batches')}>前往出版批次</Button>} style={{ marginBottom: 16 }} />
    <Row gutter={[16,16]}><Col xs={24} xl={16}><Card title="声部与出版状态"><Table rowKey="id" pagination={false} dataSource={tracks} columns={[{title:'声部',dataIndex:'name'},{title:'乐器',dataIndex:'instrument'},{title:'移调',render:(_value,row)=><Tag color={row.transposition ? 'purple' : 'blue'}>{row.transposition ? `${row.transposition > 0 ? '+' : ''}${row.transposition} 半音` : '不移调'}</Tag>},{title:'小节',render:(_value,row)=>`${new Set(row.notes.map(note=>note.id.split('-')[1])).size} 组 / ${row.notes.length} 音`},{title:'状态',render:()=><Tag color="green">可排版</Tag>}]} /></Card></Col><Col xs={24} xl={8}><Card title="出版检查"><div className="check-row"><span>和弦拼写校验</span><b className="success">通过</b></div><div className="check-row"><span>节奏完整性</span><b className="success">通过</b></div><div className="check-row"><span>换页与提示音</span><b className="danger">2 项待处理</b></div><div className="check-row"><span>分谱移调</span><b className="success">已与总谱同步</b></div><Progress percent={82} strokeColor="#2563eb" /><p className="muted">完成全部评论处理后方可锁定出版版本。</p></Card></Col></Row>
  </main>
}
