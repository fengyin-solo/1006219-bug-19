/* 服务层集成冒烟：localStorage 用内存替身，pinia / session 用 shim，
   验证：跨页同源台数、越权拒绝、班组隔离、值班清单联动、补记整套受理/退回。 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)
const srcRoot = new URL('src/', root)
const dir = mkdtempSync(join(tmpdir(), 'svc-'))

const storage = new Map()
writeFileSync(join(dir, 'dom-shim.mjs'), `
const storage = new Map(${JSON.stringify([...storage])})
globalThis.window = {
  localStorage: {
    getItem: (k) => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
}
export const __storage = storage
`)
writeFileSync(join(dir, 'session-shim.mjs'), `
export const CREWS = ['运行一班', '运行二班']
export const session = { operator: '张志强', crew: '运行一班', shiftLabel: '白班' }
export function useSessionStore() { return session }
`)
writeFileSync(join(dir, 'pinia-shim.mjs'), `
export function defineStore(_name, def) {
  const state = typeof def.state === 'function' ? def.state() : {}
  const store = { ...state }
  if (def.getters) for (const [k, fn] of Object.entries(def.getters)) {
    Object.defineProperty(store, k, { get: () => fn(store) })
  }
  if (def.actions) for (const [k, fn] of Object.entries(def.actions)) store[k] = fn.bind(store)
  return () => store
}
`)
writeFileSync(join(dir, 'entry.mjs'), `
import './dom-shim.mjs'
export {
  listEntries, runAction, getUnitBoard, getLedgerEntries, getLedgerBatches,
  getDutyRoster, submitLedgerDraft, getGapNotes,
} from '@/api/local-service'
export { session } from 'session-shim'
`)

await build({
  entryPoints: [join(dir, 'entry.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'bundle.mjs'),
  alias: {
    '@': srcRoot.pathname,
    'pinia': join(dir, 'pinia-shim.mjs'),
    '@/stores/session': join(dir, 'session-shim.mjs'),
    'session-shim': join(dir, 'session-shim.mjs'),
  },
  logLevel: 'silent',
})

const svc = await import(pathToFileURL(join(dir, 'bundle.mjs')).href)
const { session } = svc

// 初始：运行一班视角，看板 2 运行 / 3 备用 / 1 故障 / 可用 5
let board = svc.getUnitBoard()
assert.equal(board.stats.running, 2)
assert.equal(board.stats.fault, 1)
assert.equal(board.stats.available, 5)

// 值班清单：一班 3 人在场
assert.equal(svc.getDutyRoster().length, 3)

// 登记故障：4 号机属于运行二班，一班越权操作？——机组动作按全厂口径允许操作（机组不属班组私有），
// 但提交人记为一班。这里用 1 号机（一班台账可查）登记故障。
let r = svc.runAction('unit', 1, '登记故障')
assert.ok(r.ok, r.message)
board = svc.getUnitBoard()
assert.equal(board.stats.running, 1)
assert.equal(board.stats.fault, 2)

// 重复登记只算一次
r = svc.runAction('unit', 1, '登记故障')
assert.ok(!r.ok)
assert.match(r.message, /重复登记/)

// 重新并网：小时按新时段，故障区间不顺延
r = svc.runAction('unit', 1, '开机并网')
assert.ok(r.ok, r.message)
board = svc.getUnitBoard()
assert.equal(board.stats.running, 2)

// 班组隔离：值班清单页只看本班人员（一班 3 人，不是全部 6 人）
const crewPage = svc.listEntries('crew')
assert.equal(crewPage.total, 3)
assert.ok(crewPage.items.every((p) => p['所属班组'] === '运行一班'))

// 越权：尝试操作二班人员（如 id=4）
r = svc.runAction('crew', 4, '办理离场')
assert.ok(!r.ok)
assert.match(r.message, /越权/)

// 切换到运行二班
session.crew = '运行二班'
session.operator = '李海峰'
assert.equal(svc.listEntries('crew').total, 3)
assert.equal(svc.getDutyRoster().length, 2) // 二班在场 2 人（孙立群已离场）

// 二班越权替一班提交台账 -> 拒绝
r = svc.submitLedgerDraft({
  crew: '运行一班',
  submitter: '张志强',
  items: [{ unitId: 3, startedAt: '2024-01-01 08:00', endedAt: '2024-01-02 08:00' }],
})
assert.ok(!r.ok)
assert.match(r.message, /越权/)

// 二班正常提交：整套受理
r = svc.submitLedgerDraft({
  crew: '运行二班',
  submitter: '李海峰',
  items: [{ unitId: 4, startedAt: '2024-01-01 08:00', endedAt: '2024-01-02 08:00' }],
})
assert.ok(r.ok, r.message)

// 提交人不在值班清单（孙立群已离场）-> 拒绝
r = svc.submitLedgerDraft({
  crew: '运行二班',
  submitter: '孙立群',
  items: [{ unitId: 4, startedAt: '2024-02-01 08:00', endedAt: '2024-02-02 08:00' }],
})
assert.ok(!r.ok)
assert.match(r.message, /值班清单/)

// 明细只见本班：一班看不到二班刚提交的明细，反之可见
session.crew = '运行一班'
const class1Entries = svc.getLedgerEntries(true)
assert.ok(class1Entries.every((e) => e.crew === '运行一班'))
session.crew = '运行二班'
const class2Entries = svc.getLedgerEntries(true)
assert.ok(class2Entries.some((e) => e.startedAt === '2024-01-01 08:00'))

// 缺项说明在两种班组视角下都全厂可见
assert.ok(svc.getGapNotes().length >= 3)

// 重复提交（与刚退回/已入库相撞）：后到整套退回，台数不受影响
const boardBefore = JSON.stringify(svc.getUnitBoard().stats)
r = svc.submitLedgerDraft({
  crew: '运行二班',
  submitter: '李海峰',
  items: [{ unitId: 4, startedAt: '2024-01-01 08:00', endedAt: '2024-01-03 08:00' }],
})
assert.ok(!r.ok)
assert.match(r.message, /先入库一稿为准/)
assert.equal(JSON.stringify(svc.getUnitBoard().stats), boardBefore)

console.log('服务层集成冒烟全部通过 ✔')
console.log('当前看板（运行二班视角）：', svc.getUnitBoard().stats)
