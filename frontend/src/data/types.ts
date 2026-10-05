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

// 动作提交时随请求带上的值班上下文：谁提交、属于哪个班组、有没有替别的班组代交。
export type ActionContext = {
  operator: string
  crew: string
  at?: string
  onBehalfOfCrew?: string
}

// 机组并网事件：开机并网 / 停机转备 / 登记故障每次各留一条，是累计运行小时的唯一推算依据。
export type UnitEvent = {
  id: number
  unitId: number
  机组编号: string
  动作: string
  记录时间: string
  值班班组: string
  提交人: string
}

// 早期记录缺项：只有开机没有停机（或相反）时按统一规则封账，并在总览里单独说明。
export type UnitGapNote = {
  unitId: number
  机组编号: string
  记录时间: string
  rule: string
}

// 机组台数汇总：可用台数口径 = 运行中 + 停机备用（故障停机与待启动不可调度）。
export type UnitSummary = {
  total: number
  running: number
  standby: number
  fault: number
  pendingStart: number
  available: number
}

export type UnitBoardRow = {
  id: number
  机组编号: string
  机组型号: string
  status: string
  累计运行小时: number
  最近事件: string
}

export type UnitBoard = {
  summary: UnitSummary
  rows: UnitBoardRow[]
  gaps: UnitGapNote[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  unitBoard: UnitBoard
}
