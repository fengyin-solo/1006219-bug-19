import { LEDGER_SEED_BATCHES, LEDGER_SEED_ENTRIES } from './seed-ledger'
import { listRows, saveRows } from './local-store'
import { buildUnitBoard, formatTime, reconcileLedger } from './unit-ledger'
import type { EntryRow, GapNote, GridLedgerEntry, LedgerBatch } from './types'

// 并网台账单独存储：entries 是并网时段明细，batches 是整套提交/退回留痕。
const LEDGER_KEY = 'hydropower-plant-om:unit-ledger:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type LedgerState = {
  entries: GridLedgerEntry[]
  batches: LedgerBatch[]
  gaps: GapNote[]
}

let cache: LedgerState | null = null

function persist(state: LedgerState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(state))
  }
}

/** 把派生出来的累计运行小时回写到机组行的「累计运行小时」字段，另存清单随之更新。 */
function syncUnitHours(entries: GridLedgerEntry[]): void {
  const units = listRows('unit')
  const board = buildUnitBoard(units, entries, formatTime(new Date()))
  const hoursById = new Map(board.items.map((item) => [item.id, item.hours]))
  const next = units.map((row): EntryRow => {
    const hours = hoursById.get(Number(row.id))
    return hours === undefined ? row : { ...row, 累计运行小时: hours }
  })
  saveRows('unit', next)
}

export function loadLedger(): LedgerState {
  if (cache !== null) {
    return cache
  }
  const now = formatTime(new Date())
  if (typeof window === 'undefined' || !window.localStorage) {
    const fallback = reconcileLedger(listRows('unit'), clone(LEDGER_SEED_ENTRIES), now)
    cache = { entries: fallback.entries, batches: clone(LEDGER_SEED_BATCHES), gaps: fallback.gaps }
    return cache
  }
  const raw = window.localStorage.getItem(LEDGER_KEY)
  if (!raw) {
    const reconciled = reconcileLedger(listRows('unit'), clone(LEDGER_SEED_ENTRIES), now)
    const state: LedgerState = {
      entries: reconciled.entries,
      batches: clone(LEDGER_SEED_BATCHES),
      gaps: reconciled.gaps,
    }
    persist(state)
    syncUnitHours(state.entries)
    cache = state
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as LedgerState
    // 每次装载都跑一遍回填：幂等，且能兜底机组状态与台账被异常改动的情形。
    const reconciled = reconcileLedger(listRows('unit'), parsed.entries ?? [], now)
    const state: LedgerState = {
      entries: reconciled.entries,
      batches: parsed.batches ?? [],
      gaps: reconciled.gaps,
    }
    cache = state
    return state
  } catch {
    const reconciled = reconcileLedger(listRows('unit'), clone(LEDGER_SEED_ENTRIES), now)
    cache = { entries: reconciled.entries, batches: clone(LEDGER_SEED_BATCHES), gaps: reconciled.gaps }
    return cache
  }
}

export function saveLedger(next: { entries: GridLedgerEntry[]; batches: LedgerBatch[] }): void {
  const now = formatTime(new Date())
  const reconciled = reconcileLedger(listRows('unit'), next.entries, now)
  // 早年缺项说明是留档信息：本次新补记的并入已有清单（按机组+开机时刻去重），
  // 不会因为时段已收口、台账继续变动而从总览消失。
  const known = new Map(cache?.gaps.map((gap) => [`${gap.unitId}|${gap.startedAt}`, gap]) ?? [])
  for (const gap of reconciled.gaps) {
    known.set(`${gap.unitId}|${gap.startedAt}`, gap)
  }
  const gaps = [...known.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  cache = { entries: reconciled.entries, batches: next.batches, gaps }
  persist(cache)
  syncUnitHours(cache.entries)
}

export function resetLedger(): LedgerState {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(LEDGER_KEY)
  }
  cache = null
  return loadLedger()
}

export function ledgerStorageKey(): string {
  return LEDGER_KEY
}
