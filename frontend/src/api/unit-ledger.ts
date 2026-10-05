import { listRows, saveRows } from '@/data/local-store'
import { allUnitEvents, appendUnitEvent, listUnitEvents } from '@/data/unit-events'
import type {
  ActionContext,
  ActionResult,
  EntryRow,
  UnitBoard,
  UnitBoardRow,
  UnitEvent,
  UnitGapNote,
  UnitSummary,
} from '@/data/types'

// 机组运行模块的领域逻辑：状态流转、并网事件入账、累计运行小时推算、台数汇总。
// 页面不直接读写数据，统一走这里，保证列表、看板、总览、发电计划页看到的是同一份结果。

export const UNIT_MODULE_KEY = 'unit'

const STATUS_PENDING_START = '待启动'
const STATUS_RUNNING = '运行中'
const STATUS_STANDBY = '停机备用'
const STATUS_FAULT = '故障停机'

const ACTION_START = '开机并网'
const ACTION_STANDBY = '停机转备'
const ACTION_FAULT = '登记故障'

// 机组状态机：只允许从列出的来源状态执行对应动作，其余一律退回。
const TRANSITIONS: Record<string, { target: string; from: string[] }> = {
  [ACTION_START]: { target: STATUS_RUNNING, from: [STATUS_PENDING_START, STATUS_STANDBY, STATUS_FAULT] },
  [ACTION_STANDBY]: { target: STATUS_STANDBY, from: [STATUS_RUNNING] },
  [ACTION_FAULT]: { target: STATUS_FAULT, from: [STATUS_RUNNING, STATUS_STANDBY] },
}

const HOUR_MS = 3600_000

// 事件时间一律用本地朴素时间（与种子数据一致），避免 ISO 带时区与本地时间混算。
function formatLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function parseTime(value: string): number {
  return new Date(value).getTime()
}

// 缺项封账规则（裁决）：只有开机没有停机的早期记录，按记录当日 24:00 封账估算，
// 不向后顺延到下一事件，避免整段虚计；该记录列入缺项说明，待人工核实补录。
function dayEnd(time: number): number {
  const date = new Date(time)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function round1(hours: number): number {
  return Math.round(hours * 10) / 10
}

function sortEvents(events: UnitEvent[]): UnitEvent[] {
  return events.slice().sort((a, b) => parseTime(a.记录时间) - parseTime(b.记录时间) || a.id - b.id)
}

// 按并网事件台账推算一台机组的累计运行小时：
// - 开机与停机/故障一一配对，故障停机时段不计入运行小时；
// - 重新并网另起新段，只按实际并网时段补记，不整段顺延；
// - 只有开机没有停机的记录按「当日 24:00 封账」估算并记入缺项；
// - 当前仍运行中的机组，开口段计至 now。
export function computeUnitHours(
  unit: EntryRow,
  now: number,
): { hours: number; gaps: UnitGapNote[] } {
  const unitId = Number(unit.id)
  const 机组编号 = String(unit['机组编号'] ?? '')
  const gaps: UnitGapNote[] = []
  let totalMs = 0
  let open: UnitEvent | null = null
  let seenAny = false

  const closeAtDayEnd = (event: UnitEvent) => {
    totalMs += Math.max(0, dayEnd(parseTime(event.记录时间)) - parseTime(event.记录时间))
    gaps.push({
      unitId,
      机组编号,
      记录时间: event.记录时间,
      rule: '只有开机记录、缺停机记录，按当日 24:00 封账估算，待人工核实补录',
    })
  }

  for (const event of sortEvents(listUnitEvents(unitId))) {
    if (event.动作 === ACTION_START) {
      if (open) {
        // 前一段开机没有等到停机就又有开机记录：前一段属缺项，当日封账，不顺延。
        closeAtDayEnd(open)
      }
      open = event
    } else if (open) {
      // 停机转备 / 登记故障都会合上开口段，故障时刻即停止计小时。
      totalMs += Math.max(0, parseTime(event.记录时间) - parseTime(open.记录时间))
      open = null
    } else if (!seenAny) {
      // 首条记录就是停机/故障：缺开机记录，属早期缺项。
      // （前面已有停机类记录的，属于备用状态下再登记故障等正常流转，不算缺项。）
      gaps.push({
        unitId,
        机组编号,
        记录时间: event.记录时间,
        rule: '有停机/故障记录但缺开机记录，该段不计运行小时，待人工核实补录',
      })
    }
    seenAny = true
  }

  if (open) {
    if (String(unit.status) === STATUS_RUNNING) {
      totalMs += Math.max(0, now - parseTime(open.记录时间))
    } else {
      closeAtDayEnd(open)
    }
  }

  return { hours: round1(totalMs / HOUR_MS), gaps }
}

// 台数汇总：全部从机组台账当前状态实时点数，列表、看板、总览、发电计划页同源。
export function summarizeUnits(rows: EntryRow[] = listRows(UNIT_MODULE_KEY)): UnitSummary {
  const count = (status: string) => rows.filter((row) => String(row.status) === status).length
  const running = count(STATUS_RUNNING)
  const standby = count(STATUS_STANDBY)
  const fault = count(STATUS_FAULT)
  const pendingStart = count(STATUS_PENDING_START)
  return {
    total: rows.length,
    running,
    standby,
    fault,
    pendingStart,
    // 可用台数口径：运行中 + 停机备用；故障停机与待启动不可调度。
    available: running + standby,
  }
}

// 回填累计运行小时：推算值覆盖台账手填值（取值优先级：并网事件台账 > 台账手填值，
// 理由是事件台账带时间戳、可追溯、能剔除故障时段；手填值只是缓存）。
// 同时把 pending/abnormal 标志按当前状态归一，让总览的待处理/异常量与状态对得上。
// 返回本次回填发现的缺项说明。
export function syncUnitHours(now: number = Date.now()): UnitGapNote[] {
  const rows = listRows(UNIT_MODULE_KEY)
  const gaps: UnitGapNote[] = []
  let changed = false
  const next = rows.map((row) => {
    const { hours, gaps: rowGaps } = computeUnitHours(row, now)
    gaps.push(...rowGaps)
    const status = String(row.status)
    const pending = status === STATUS_FAULT || status === STATUS_PENDING_START
    const abnormal = status === STATUS_FAULT
    if (
      Number(row['累计运行小时']) !== hours ||
      row.pending !== pending ||
      row.abnormal !== abnormal
    ) {
      changed = true
      return { ...row, 累计运行小时: hours, pending, abnormal }
    }
    return row
  })
  if (changed) {
    saveRows(UNIT_MODULE_KEY, next)
  }
  return gaps
}

// 机组状态流转：登记故障 / 停机转备 / 开机并网。
// 台数不单独维护，流转落库后由 summarizeUnits 重新点数，各处自然一致。
export function applyUnitAction(id: number, action: string, context: ActionContext): ActionResult {
  // 越权检查：替别的班组代交的提交一律拒绝，什么都不写。
  if (context.onBehalfOfCrew && context.onBehalfOfCrew !== context.crew) {
    return {
      ok: false,
      message: `越权操作：当前值班班组是「${context.crew}」，不能替「${context.onBehalfOfCrew}」提交，已拒绝`,
    }
  }

  const transition = TRANSITIONS[action]
  if (!transition) {
    return { ok: false, message: `水轮发电机组没有登记「${action}」这个动作` }
  }

  const rows = listRows(UNIT_MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的水轮发电机组` }
  }
  const row = rows[index]
  const current = String(row.status)

  // 同一台机组重复登记故障只算一次：已故障的再登记直接退回，不会多扣台数。
  if (action === ACTION_FAULT && current === STATUS_FAULT) {
    return { ok: false, message: '该机组已登记故障，同一台机组重复登记只算一次，本次已退回' }
  }
  if (!transition.from.includes(current)) {
    return { ok: false, message: `机组当前状态「${current}」不允许执行「${action}」，已退回` }
  }

  const at = context.at ?? formatLocal(new Date())
  const event: Omit<UnitEvent, 'id'> = {
    unitId: id,
    机组编号: String(row['机组编号'] ?? ''),
    动作: action,
    记录时间: at,
    值班班组: context.crew,
    提交人: context.operator,
  }
  // 重复提交只留一条：与已入库记录重复的，后到的整套退回，以最先入库的一稿为准。
  if (!appendUnitEvent(event)) {
    return {
      ok: false,
      message: `重复提交：${at} 的「${action}」已入库，以最先入库的一稿为准，本次整套退回`,
    }
  }

  const updated: EntryRow = {
    ...row,
    status: transition.target,
    pending: transition.target === STATUS_FAULT || transition.target === STATUS_PENDING_START,
    abnormal: transition.target === STATUS_FAULT,
  }
  // 事件入账后立刻按台账重算本机小时并写回，另存的机组清单跟着改。
  updated['累计运行小时'] = computeUnitHours(updated, parseTime(at)).hours

  const next = [...rows]
  next[index] = updated
  saveRows(UNIT_MODULE_KEY, next)

  const summary = summarizeUnits(next)
  return {
    ok: true,
    message: `机组已${action}，当前状态「${transition.target}」；运行中 ${summary.running} 台、停机备用 ${summary.standby} 台、故障停机 ${summary.fault} 台`,
  }
}

// 机组运行明细板：先回填小时数，再汇总台数与逐台明细，供总览与机组页使用。
export function loadUnitBoard(): UnitBoard {
  const gaps = syncUnitHours()
  const rows = listRows(UNIT_MODULE_KEY)
  const events = allUnitEvents()
  const boardRows: UnitBoardRow[] = rows.map((row) => {
    const unitEvents = sortEvents(events.filter((event) => event.unitId === Number(row.id)))
    const latest = unitEvents.length > 0 ? unitEvents[unitEvents.length - 1] : undefined
    return {
      id: Number(row.id),
      机组编号: String(row['机组编号'] ?? ''),
      机组型号: String(row['机组型号'] ?? ''),
      status: String(row.status),
      累计运行小时: Number(row['累计运行小时'] ?? 0),
      最近事件: latest ? `${latest.记录时间} ${latest.动作}` : '—',
    }
  })
  return { summary: summarizeUnits(rows), rows: boardRows, gaps }
}

// 值班清单：只看得到本班组的记录；状态与小时数直接取机组台账当前值，与台账联动。
export function listDutyRoster(crew: string): { event: UnitEvent; status: string; hours: number }[] {
  const rows = listRows(UNIT_MODULE_KEY)
  return sortEvents(allUnitEvents())
    .filter((event) => event.值班班组 === crew)
    .reverse()
    .map((event) => {
      const row = rows.find((item) => Number(item.id) === event.unitId)
      return {
        event,
        status: row ? String(row.status) : '—',
        hours: row ? Number(row['累计运行小时'] ?? 0) : 0,
      }
    })
}
