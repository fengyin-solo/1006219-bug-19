import type { UnitEvent } from './types'

// 机组并网事件台账：与机组台账分开持久化，累计运行小时只按这份台账推算，
// 机组台账上的「累计运行小时」字段只是推算结果的缓存（见 unit-ledger.ts）。
const STORAGE_KEY = 'hydropower-plant-om:unit-events'

// 示例并网记录。UNIT-0002 目前运行中（最后一条开机记录开口至今），UNIT-0003 停机备用。
// 其中 2026-08-05 07:30 的开机记录缺停机时间，属于早期缺项，
// 按「当日 24:00 封账」规则估算，并在运营概览的缺项说明里单独列出。
export const SEED_UNIT_EVENTS: UnitEvent[] = [
  { id: 1, unitId: 2, 机组编号: 'UNIT-0002', 动作: '开机并网', 记录时间: '2026-09-10T08:00:00', 值班班组: '运行一值', 提交人: '值班管理员' },
  { id: 2, unitId: 2, 机组编号: 'UNIT-0002', 动作: '停机转备', 记录时间: '2026-09-12T18:00:00', 值班班组: '运行二值', 提交人: '值班管理员' },
  { id: 3, unitId: 2, 机组编号: 'UNIT-0002', 动作: '开机并网', 记录时间: '2026-09-15T09:00:00', 值班班组: '运行一值', 提交人: '值班管理员' },
  { id: 4, unitId: 2, 机组编号: 'UNIT-0002', 动作: '登记故障', 记录时间: '2026-09-16T11:00:00', 值班班组: '运行一值', 提交人: '值班管理员' },
  { id: 5, unitId: 2, 机组编号: 'UNIT-0002', 动作: '开机并网', 记录时间: '2026-09-18T14:00:00', 值班班组: '运行二值', 提交人: '值班管理员' },
  { id: 6, unitId: 2, 机组编号: 'UNIT-0002', 动作: '停机转备', 记录时间: '2026-09-20T09:00:00', 值班班组: '运行二值', 提交人: '值班管理员' },
  { id: 7, unitId: 2, 机组编号: 'UNIT-0002', 动作: '开机并网', 记录时间: '2026-09-28T08:00:00', 值班班组: '运行一值', 提交人: '值班管理员' },
  { id: 8, unitId: 3, 机组编号: 'UNIT-0003', 动作: '开机并网', 记录时间: '2026-08-05T07:30:00', 值班班组: '运行二值', 提交人: '值班管理员' },
  { id: 9, unitId: 3, 机组编号: 'UNIT-0003', 动作: '开机并网', 记录时间: '2026-09-01T08:00:00', 值班班组: '运行一值', 提交人: '值班管理员' },
  { id: 10, unitId: 3, 机组编号: 'UNIT-0003', 动作: '停机转备', 记录时间: '2026-09-03T17:00:00', 值班班组: '运行一值', 提交人: '值班管理员' },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): UnitEvent[] {
  const fallback = clone(SEED_UNIT_EVENTS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as UnitEvent[]
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: UnitEvent[] | null = null

export function allUnitEvents(): UnitEvent[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listUnitEvents(unitId?: number): UnitEvent[] {
  const events = allUnitEvents()
  if (unitId === undefined) {
    return events
  }
  return events.filter((event) => event.unitId === unitId)
}

export function saveUnitEvents(events: UnitEvent[]): void {
  cache = events
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  }
}

export function resetUnitEvents(): UnitEvent[] {
  const events = clone(SEED_UNIT_EVENTS)
  saveUnitEvents(events)
  return events
}

// 重复提交只留一条：同机组、同动作、同一分钟的事件视为重复，以最先入库的一稿为准。
function dedupeKey(event: Pick<UnitEvent, 'unitId' | '动作' | '记录时间'>): string {
  return `${event.unitId}|${event.动作}|${event.记录时间.slice(0, 16)}`
}

export function findDuplicateEvent(event: Omit<UnitEvent, 'id'>): UnitEvent | undefined {
  const key = dedupeKey(event)
  return allUnitEvents().find((item) => dedupeKey(item) === key)
}

// 追加事件；若与已入库记录重复则整条退回，返回 null。
export function appendUnitEvent(event: Omit<UnitEvent, 'id'>): UnitEvent | null {
  if (findDuplicateEvent(event)) {
    return null
  }
  const events = allUnitEvents()
  const nextId = events.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const saved: UnitEvent = { ...event, id: nextId }
  saveUnitEvents([...events, saved])
  return saved
}
