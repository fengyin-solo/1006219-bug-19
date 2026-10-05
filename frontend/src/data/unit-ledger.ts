import type {
  EntryRow,
  GapNote,
  GridLedgerEntry,
  LedgerBatch,
  LedgerDraft,
  UnitBoard,
} from './types'

/**
 * 机组并网台账的领域逻辑。
 *
 * 老毛病的根因：状态变更只写机组自己的 status 字段，运行台数、备用容量、
 * 故障台数以及累计运行小时全都还按旧值算。这里统一改为「台账 + 派生」：
 *  - 开机并网开出一条并网时段，停机转备 / 故障解列把同一条时段收口；
 *  - 台数、容量、小时数一律由机组表 + 并网台账实时派生，列表、看板、
 *    发电计划页共用同一份结果，谁也不可能再各算各的。
 */

export const UNIT_STATUS = {
  pending: '待启动',
  running: '运行中',
  standby: '停机备用',
  fault: '故障停机',
} as const

// ---- 时间：内部统一用 'YYYY-MM-DD HH:mm' 文本，便于排序与人工核对 ----

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  )
}

export function parseTime(text: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim())
  if (!match) {
    throw new Error(`时间「${text}」格式不正确，应为 YYYY-MM-DD HH:mm`)
  }
  const [, year, month, day, hour, minute] = match
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
}

/** 并网时长（小时），保留两位小数；倒挂时段按 0 计，避免负值污染累计。 */
export function hoursBetween(start: string, end: string): number {
  const ms = parseTime(end).getTime() - parseTime(start).getTime()
  return Math.max(0, Math.round((ms / 3_600_000) * 100) / 100)
}

export function yearEnd(year: number): string {
  return `${year}-12-31 23:59`
}

// ---- 机组基础数据 ----

export function unitCode(row: EntryRow): string {
  return String(row['机组编号'] ?? '')
}

/** 额定出力（MW）：样本期脏数据按 0 计，不参与容量汇总。 */
export function unitCapacity(row: EntryRow): number {
  const value = Number(row['有功出力'])
  return Number.isFinite(value) && value > 0 ? value : 0
}

function latestId<T extends { id: number }>(rows: T[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
}

export function nextId<T extends { id: number }>(rows: T[]): number {
  return latestId(rows) + 1
}

// ---- 并网台账 ----

export type LedgerHours = Map<number, number>

/**
 * 存量台账回填：把早年「只有开机、没有停机」的开口时段逐条收口。
 * 裁决规则（同一台机组按时间顺序）：
 *  1. 后面还有并网记录的，收口到下一条记录的并网时刻 —— 现场可核对的最近凭证；
 *  2. 后面再无记录的，封到开机当年 12-31 23:59 —— 不跨年臆测，缺口在总览列明；
 *  3. 机组当前仍在运行，则只允许其最后一条保持开口，按实时时刻累计。
 * 幂等：已经闭合的记录不再改动。
 */
export function reconcileLedger(
  units: EntryRow[],
  entries: GridLedgerEntry[],
  now: string,
): { entries: GridLedgerEntry[]; gaps: GapNote[] } {
  const gaps: GapNote[] = []
  const result: GridLedgerEntry[] = []

  const byUnit = new Map<number, GridLedgerEntry[]>()
  for (const entry of entries) {
    const list = byUnit.get(entry.unitId) ?? []
    list.push(entry)
    byUnit.set(entry.unitId, list)
  }

  const runningIds = new Set(
    units
      .filter((row) => String(row.status) === UNIT_STATUS.running)
      .map((row) => Number(row.id)),
  )

  for (const [unitId, list] of byUnit) {
    const sorted = [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    sorted.forEach((entry, index) => {
      if (entry.endedAt !== null) {
        // 小时数一律由开/收口时间戳重算，避免手填值与时段不一致（以时间戳为准）。
        result.push({ ...entry, hours: hoursBetween(entry.startedAt, entry.endedAt) })
        return
      }
      const next = sorted[index + 1]
      const isCurrentOpen =
        next === undefined && runningIds.has(unitId)
      if (isCurrentOpen) {
        result.push(entry)
        return
      }
      const closedAt = next ? next.startedAt : yearEnd(Number(entry.startedAt.slice(0, 4)))
      const rule: GapNote['rule'] = next ? 'next-event' : 'year-end'
      const closed: GridLedgerEntry = {
        ...entry,
        endedAt: closedAt,
        hours: hoursBetween(entry.startedAt, closedAt),
        source: '历史补记',
        note:
          rule === 'next-event'
            ? `早期缺停机时间，按下一条并网记录时刻 ${closedAt} 补记`
            : `早期缺停机时间且其后无记录，暂封至开机年度年末 ${closedAt}，待凭证核实`,
      }
      result.push(closed)
      gaps.push({
        unitId,
        unitCode: entry.unitCode,
        startedAt: entry.startedAt,
        closedAt,
        rule,
        hours: closed.hours ?? 0,
        note: closed.note,
      })
    })
  }

  result.sort(
    (a, b) => b.recordTime.localeCompare(a.recordTime) || b.startedAt.localeCompare(a.startedAt),
  )
  return { entries: result, gaps }
}

/** 每台机组的累计运行小时：所有闭合时段 + 当前开口时段算到 now。 */
export function hoursByUnit(entries: GridLedgerEntry[], now: string): LedgerHours {
  const map = new Map<number, number>()
  for (const entry of entries) {
    const span = entry.endedAt === null ? hoursBetween(entry.startedAt, now) : entry.hours ?? 0
    map.set(entry.unitId, Math.round(((map.get(entry.unitId) ?? 0) + span) * 100) / 100)
  }
  return map
}

function findOpenEntry(entries: GridLedgerEntry[], unitId: number): GridLedgerEntry | undefined {
  return entries.find((entry) => entry.unitId === unitId && entry.endedAt === null)
}

// ---- 看板：台数、备用容量、可用台数全部在此一处派生 ----

/**
 * 可用台数取值：运行中 + 停机备用；故障停机与待启动都不能立刻顶上负荷。
 */
export function buildUnitBoard(
  units: EntryRow[],
  entries: GridLedgerEntry[],
  now: string,
): UnitBoard {
  const hoursMap = hoursByUnit(entries, now)
  const items: UnitBoard['items'] = units.map((row) => ({
    id: Number(row.id),
    code: unitCode(row),
    model: String(row['机组型号'] ?? ''),
    status: String(row.status),
    capacity: unitCapacity(row),
    hours: hoursMap.get(Number(row.id)) ?? 0,
  }))
  const count = (status: string) => items.filter((item) => item.status === status).length
  const running = count(UNIT_STATUS.running)
  const standby = count(UNIT_STATUS.standby)
  const fault = count(UNIT_STATUS.fault)
  return {
    stats: {
      total: items.length,
      running,
      standby,
      standbyCapacity: items
        .filter((item) => item.status === UNIT_STATUS.standby)
        .reduce((sum, item) => Math.round((sum + item.capacity) * 100) / 100, 0),
      fault,
      pendingStart: count(UNIT_STATUS.pending),
      available: running + standby,
    },
    items,
  }
}

// ---- 状态流转：动作同时改机组状态与并网台账 ----

export type ActionContext = {
  crew: string
  operator: string
  now: string
}

export type ActionOutcome = {
  ok: boolean
  message: string
  units: EntryRow[]
  entries: GridLedgerEntry[]
}

function withStatus(units: EntryRow[], id: number, status: string): EntryRow[] {
  return units.map((row) =>
    Number(row.id) === id
      ? { ...row, status, 运行状态: status, abnormal: status === UNIT_STATUS.fault, pending: false }
      : row,
  )
}

/**
 * 登记机组运行动作。
 *  - 开机并网：非运行中才受理，开出一条新的并网时段（故障修复后再并网是新时段，
 *    故障停机那段天然不进小时数，不会再整段顺延）；
 *  - 停机转备：收口当前并网时段；
 *  - 登记故障：收口当前并网时段；同一台机组故障未消除前重复登记一律拒绝，只扣一次。
 */
export function applyUnitAction(
  units: EntryRow[],
  entries: GridLedgerEntry[],
  id: number,
  action: '开机并网' | '停机转备' | '登记故障',
  ctx: ActionContext,
): ActionOutcome {
  const unit = units.find((row) => Number(row.id) === id)
  if (!unit) {
    return { ok: false, message: `没有找到编号为 ${id} 的机组`, units, entries }
  }
  const current = String(unit.status)
  const name = unitCode(unit)

  if (action === '开机并网') {
    if (current === UNIT_STATUS.running) {
      return { ok: false, message: `机组 ${name} 已在运行中，重复并网不会多记小时`, units, entries }
    }
    const open = findOpenEntry(entries, id)
    if (open) {
      return {
        ok: false,
        message: `机组 ${name} 存在未收口的并网时段（${open.startedAt} 起），请先核实台账`,
        units,
        entries,
      }
    }
    const entry: GridLedgerEntry = {
      id: nextId(entries),
      unitId: id,
      unitCode: name,
      startedAt: ctx.now,
      endedAt: null,
      hours: null,
      source: '事件记录',
      note: '开机并网',
      crew: ctx.crew,
      submitter: ctx.operator,
      recordTime: ctx.now,
      batchId: 0,
    }
    return {
      ok: true,
      message: `机组 ${name} 已并网，新并网时段自 ${ctx.now} 起记，故障停机时段不计小时`,
      units: withStatus(units, id, UNIT_STATUS.running),
      entries: [entry, ...entries],
    }
  }

  if (action === '停机转备') {
    if (current === UNIT_STATUS.standby) {
      return { ok: false, message: `机组 ${name} 已是停机备用`, units, entries }
    }
    const open = findOpenEntry(entries, id)
    let nextEntries = entries
    if (open) {
      nextEntries = entries.map((entry) =>
        entry.id === open.id
          ? {
              ...entry,
              endedAt: ctx.now,
              hours: hoursBetween(entry.startedAt, ctx.now),
              note: `${entry.note}；停机转备收口`,
            }
          : entry,
      )
    }
    return {
      ok: true,
      message: `机组 ${name} 已停机转备，本次并网 ${open ? hoursBetween(open.startedAt, ctx.now) : 0} 小时已入账`,
      units: withStatus(units, id, UNIT_STATUS.standby),
      entries: nextEntries,
    }
  }

  // 登记故障：同一台机组故障期间重复登记只算一次。
  if (current === UNIT_STATUS.fault) {
    return {
      ok: false,
      message: `机组 ${name} 已处于故障停机，重复登记不予受理，故障台数不会重复扣减`,
      units,
      entries,
    }
  }
  const open = findOpenEntry(entries, id)
  let nextEntries = entries
  if (open) {
    nextEntries = entries.map((entry) =>
      entry.id === open.id
        ? {
            ...entry,
            endedAt: ctx.now,
            hours: hoursBetween(entry.startedAt, ctx.now),
            note: `${entry.note}；故障解列收口`,
          }
        : entry,
    )
  }
  return {
    ok: true,
    message: `机组 ${name} 已登记故障：运行台数、备用容量同步回落，故障台数 +1；修复并网后按新时段补记小时`,
    units: withStatus(units, id, UNIT_STATUS.fault),
    entries: nextEntries,
  }
}

// ---- 台账补记：先入库的一稿为准，后到的整套退回，重复提交只留一条 ----

export type AcceptResult = {
  ok: boolean
  message: string
  reason: string
  batch: LedgerBatch
  entries: GridLedgerEntry[]
}

/**
 * 整套校验、整套受理/退回。幂等键 = 机组 + 并网时刻（同一台机组不可能在同一时刻
 * 并网两次）：批内自撞、与已入库记录相撞、与已退回批次内容相同，都整套退回。
 */
export function acceptLedgerDraft(
  units: EntryRow[],
  entries: GridLedgerEntry[],
  batches: LedgerBatch[],
  draft: LedgerDraft,
  now: string,
): AcceptResult {
  const batchId = nextId(batches)
  const signature = draft.items
    .map((item) => `${item.unitId}|${item.startedAt}|${item.endedAt ?? ''}`)
    .sort()
    .join('||')
  const reject = (reason: string, duplicateOf: number | null = null): AcceptResult => ({
    ok: false,
    message: `补记台账整套退回：${reason}`,
    reason,
    batch: {
      id: batchId,
      crew: draft.crew,
      submitter: draft.submitter,
      submittedAt: now,
      accepted: false,
      reason,
      entryIds: [],
      draftCount: draft.items.length,
      duplicateOf,
      signature,
    },
    entries,
  })

  if (draft.items.length === 0) {
    return reject('补记明细为空')
  }

  const unitById = new Map(units.map((row) => [Number(row.id), row]))

  // 批内重复：同一机组同一并网时刻只许出现一条。
  const keysInBatch = new Set<string>()
  for (const item of draft.items) {
    const key = `${item.unitId}|${item.startedAt}`
    if (keysInBatch.has(key)) {
      return reject(`批内存在重复明细：机组 ${item.unitId} 于 ${item.startedAt} 重复提交`)
    }
    keysInBatch.add(key)
  }

  // 与此前整套退回的批次内容完全相同：重复提交只留一条（退回）记录。
  // 放在时间合法性校验之前，保证同一坏批次原样重提时结论稳定为「重复提交」。
  const prior = batches.find((batch) => !batch.accepted && batch.signature === signature)
  if (prior) {
    return reject(`与退回批次 #${prior.id} 内容完全相同，重复提交只保留一条退回留痕`, prior.id)
  }

  for (const item of draft.items) {
    if (!unitById.has(item.unitId)) {
      return reject(`含不存在的机组编号 ${item.unitId}`)
    }
    try {
      parseTime(item.startedAt)
      if (item.endedAt !== null) parseTime(item.endedAt)
    } catch (error) {
      return reject(error instanceof Error ? error.message : '时间格式不正确')
    }
    if (item.endedAt !== null && item.endedAt <= item.startedAt) {
      return reject('存在停机时间早于或等于并网时间的明细')
    }
  }

  // 与已入库记录相撞：先入库的一稿为准。
  for (const item of draft.items) {
    const clash = entries.find(
      (entry) => entry.unitId === item.unitId && entry.startedAt === item.startedAt,
    )
    if (clash) {
      return reject(
        `机组 ${clash.unitCode} 于 ${item.startedAt} 的并网时段已在台账中（#${clash.batchId === 0 ? '事件' : clash.batchId}），以先入库一稿为准`,
        clash.batchId || null,
      )
    }
  }

  const created: GridLedgerEntry[] = draft.items.map((item, index) => {
    const unit = unitById.get(item.unitId)!
    return {
      id: nextId(entries) + index + 1,
      unitId: item.unitId,
      unitCode: unitCode(unit),
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      hours: item.endedAt === null ? null : hoursBetween(item.startedAt, item.endedAt),
      source: '台账提交',
      note: '补记并网时段',
      crew: draft.crew,
      submitter: draft.submitter,
      recordTime: now,
      batchId,
    }
  })

  return {
    ok: true,
    message: `补记台账整套受理，新增 ${created.length} 条并网时段`,
    reason: '',
    batch: {
      id: batchId,
      crew: draft.crew,
      submitter: draft.submitter,
      submittedAt: now,
      accepted: true,
      reason: '',
      entryIds: created.map((entry) => entry.id),
      draftCount: draft.items.length,
      duplicateOf: null,
      signature,
    },
    entries: [...created, ...entries],
  }
}
