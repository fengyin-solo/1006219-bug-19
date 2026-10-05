import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { loadLedger, saveLedger } from '@/data/ledger-store'
import {
  acceptLedgerDraft,
  applyUnitAction,
  buildUnitBoard,
  formatTime,
} from '@/data/unit-ledger'
import { useSessionStore } from '@/stores/session'
import type {
  ActionResult,
  EntryRow,
  GridLedgerEntry,
  GapNote,
  LedgerBatch,
  ModuleMeta,
  OverviewResult,
  PageResult,
  UnitBoard,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function currentCrew(): string {
  return useSessionStore().crew
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 值班清单与台账按班组隔离：只看得到属于自己的记录。
function crewScopeRows(key: string): EntryRow[] {
  if (key !== 'crew') {
    return listRows(key)
  }
  const crew = currentCrew()
  return listRows(key).filter((row) => String(row['所属班组'] ?? '') === crew)
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(crewScopeRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)

  // 机组运行：动作同时改机组状态与并网台账，台数/容量/小时数由同一份数据派生。
  if (key === 'unit') {
    if (action !== '开机并网' && action !== '停机转备' && action !== '登记故障') {
      return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
    }
    const ledger = loadLedger()
    const outcome = applyUnitAction(listRows('unit'), ledger.entries, id, action, {
      crew: currentCrew(),
      operator: useSessionStore().operator,
      now: formatTime(new Date()),
    })
    if (!outcome.ok) {
      return { ok: false, message: outcome.message }
    }
    saveRows('unit', outcome.units)
    saveLedger({ ...ledger, entries: outcome.entries })
    return { ok: true, message: outcome.message }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = crewScopeRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    // 越权：操作不到别的班组的人，给明确拒绝，而不是假装没有这条记录。
    const existsElsewhere = listRows(key).some((row) => Number(row.id) === id)
    if (existsElsewhere) {
      return { ok: false, message: `越权操作已拒绝：该记录不属于${currentCrew()}` }
    }
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const all = listRows(key)
  const next = all.map((row) => (Number(row.id) === id ? updated : row))
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of crewScopeRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ===== 机组运行看板 / 并网台账（列表、看板、发电计划页共用同一来源）=====

export function getUnitBoard(): UnitBoard {
  const ledger = loadLedger()
  return buildUnitBoard(listRows('unit'), ledger.entries, formatTime(new Date()))
}

export function getLedgerEntries(scopeCrew = true): GridLedgerEntry[] {
  const entries = loadLedger().entries
  if (!scopeCrew) {
    return entries
  }
  const crew = currentCrew()
  return entries.filter((entry) => entry.crew === crew)
}

export function getLedgerBatches(scopeCrew = true): LedgerBatch[] {
  const batches = loadLedger().batches
  if (!scopeCrew) {
    return batches
  }
  const crew = currentCrew()
  return batches.filter((batch) => batch.crew === crew)
}

export function getGapNotes(): GapNote[] {
  return loadLedger().gaps
}

// 值班清单：当前班组「在场」的人员；台账提交人必须出自这份清单。
export function getDutyRoster(): EntryRow[] {
  const crew = currentCrew()
  return listRows('crew').filter(
    (row) => String(row['所属班组'] ?? '') === crew && String(row.status) === '在场',
  )
}

export type SubmitResult = {
  ok: boolean
  message: string
  batch: LedgerBatch | null
}

/**
 * 补记并网台账。越权（替别的班组提交）一律拒绝；其余校验由领域层整套处理：
 * 以最先入库的一稿为准，后到的整套退回，重复提交只留一条退回留痕。
 */
export function submitLedgerDraft(payload: {
  crew: string
  submitter: string
  items: { unitId: number; startedAt: string; endedAt: string | null }[]
}): SubmitResult {
  const crew = currentCrew()
  if (payload.crew !== crew) {
    return {
      ok: false,
      message: `越权提交已拒绝：${crew}不能替${payload.crew}登记台账，只接受本班值班清单内的提交`,
      batch: null,
    }
  }
  const roster = getDutyRoster()
  if (!roster.some((row) => String(row['姓名']) === payload.submitter)) {
    return {
      ok: false,
      message: `提交人「${payload.submitter}」不在${crew}当前值班清单（在场人员）内，台账与值班清单联动，拒绝登记`,
      batch: null,
    }
  }
  const ledger = loadLedger()
  const result = acceptLedgerDraft(
    listRows('unit'),
    ledger.entries,
    ledger.batches,
    { crew: payload.crew, submitter: payload.submitter, items: payload.items },
    formatTime(new Date()),
  )
  if (result.ok) {
    saveLedger({
      entries: result.entries,
      batches: [result.batch, ...ledger.batches],
    })
  } else {
    saveLedger({
      entries: ledger.entries,
      batches: [result.batch, ...ledger.batches],
    })
  }
  return { ok: result.ok, message: result.message, batch: result.batch }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
