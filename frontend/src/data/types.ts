/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ===== 机组并网台账 =====
// 一条记录就是一个并网时段：开机并网开出 startedAt，停机转备 / 故障解列写 endedAt。
// endedAt 为 null 表示仍在并网（仅允许出现在当前「运行中」的机组上）。
export type GridLedgerEntry = {
  id: number
  unitId: number
  unitCode: string
  startedAt: string
  endedAt: string | null
  hours: number | null
  source: '事件记录' | '历史补记' | '台账提交'
  note: string
  crew: string
  submitter: string
  recordTime: string
  batchId: number
}

// 并网台账补记按整套提交、整套受理或整套退回；退回也留痕，说明先入为准的裁决结果。
export type LedgerBatch = {
  id: number
  crew: string
  submitter: string
  submittedAt: string
  accepted: boolean
  reason: string
  entryIds: number[]
  draftCount: number
  duplicateOf: number | null
  signature?: string
}

// 早年只有开机时间、没有停机时间的缺项，按裁决规则补记后逐条列明。
export type GapNote = {
  unitId: number
  unitCode: string
  startedAt: string
  closedAt: string
  rule: 'next-event' | 'year-end'
  hours: number
  note: string
}

export type LedgerDraftItem = {
  unitId: number
  startedAt: string
  endedAt: string | null
}

export type LedgerDraft = {
  crew: string
  submitter: string
  items: LedgerDraftItem[]
}

export type UnitBoardStats = {
  total: number
  running: number
  standby: number
  standbyCapacity: number
  fault: number
  pendingStart: number
  available: number
}

export type UnitBoardItem = {
  id: number
  code: string
  model: string
  status: string
  capacity: number
  hours: number
}

export type UnitBoard = {
  stats: UnitBoardStats
  items: UnitBoardItem[]
}
