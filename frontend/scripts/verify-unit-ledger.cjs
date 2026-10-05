/**
 * 机组并网台账领域规则验证（纯 Node，无浏览器依赖）。
 * 运行：npx tsc --module commonjs --target ES2020 --outDir /tmp/unit-test \
 *        src/data/unit-ledger.ts src/data/seed.ts src/data/seed-ledger.ts src/data/types.ts
 *      node scripts/verify-unit-ledger.cjs
 */
const assert = require('node:assert/strict')
const path = require('node:path')

const OUT = process.env.UNIT_TEST_OUT || '/tmp/unit-test'
const domain = require(path.join(OUT, 'unit-ledger.js'))
const { SEED_ROWS } = require(path.join(OUT, 'seed.js'))
const { LEDGER_SEED_ENTRIES, LEDGER_SEED_BATCHES } = require(path.join(OUT, 'seed-ledger.js'))

const NOW = '2026-10-05 10:00'
const CTX = { crew: '运行一班', operator: '张志强', now: NOW }

let units = SEED_ROWS.unit.map((r) => ({ ...r }))
let entries = LEDGER_SEED_ENTRIES.map((r) => ({ ...r }))
let batches = LEDGER_SEED_BATCHES.map((r) => ({ ...r }))

// 1) 存量回填：早年开口时段被收口，且缺项逐条列出
let rec = domain.reconcileLedger(units, entries, NOW)
entries = rec.entries
const gaps = rec.gaps
assert.ok(gaps.length >= 3, '应识别出至少 3 条早年缺项')
const gap5 = gaps.find((g) => g.unitId === 5 && g.rule === 'next-event')
const gap6 = gaps.find((g) => g.unitId === 6 && g.rule === 'next-event')
const gap7 = gaps.find((g) => g.unitId === 7 && g.rule === 'year-end')
assert.ok(gap5, '5 号机 2020 年缺项应按下一条记录收口')
assert.ok(gap6, '6 号机 2019 年缺项应按下一条记录收口')
assert.ok(gap7, '7 号机 2018 年缺项其后无记录，应封到年度年末')
assert.equal(gap7.closedAt, '2018-12-31 23:59')

// 2) 初始看板：2 运行 / 3 备用(UNIT-0003 15 + UNIT-0006 40 + UNIT-0007 30 = 85MW) / 1 故障 / 1 待启动
let board = domain.buildUnitBoard(units, entries, NOW)
assert.equal(board.stats.running, 2)
assert.equal(board.stats.standby, 3)
assert.equal(board.stats.standbyCapacity, 85)
assert.equal(board.stats.fault, 1)
assert.equal(board.stats.pendingStart, 1)
assert.equal(board.stats.available, 5)

// 3) 登记故障（1 号机，运行中）：运行 -1、故障 +1；并网时段收口
let res = domain.applyUnitAction(units, entries, 1, '登记故障', CTX)
assert.ok(res.ok, res.message)
units = res.units
entries = res.entries
board = domain.buildUnitBoard(units, entries, NOW)
assert.equal(board.stats.running, 1, '登记故障后运行中台数应减 1')
assert.equal(board.stats.fault, 2, '故障台数应 +1')
assert.equal(board.stats.available, 4, '可用台数应回落')
assert.ok(!entries.find((e) => e.unitId === 1 && e.endedAt === null), '故障时机组并网时段应收口')

// 4) 重复登记故障只算一次
res = domain.applyUnitAction(units, entries, 1, '登记故障', CTX)
assert.ok(!res.ok, '重复登记故障必须被拒绝')
board = domain.buildUnitBoard(units, entries, NOW)
assert.equal(board.stats.fault, 2, '重复登记不得多扣台数')

// 5) 故障期间重新并网：新时段从并网时刻起，故障区间不计小时
const beforeHours = domain.buildUnitBoard(units, entries, NOW).items.find((i) => i.id === 1).hours
res = domain.applyUnitAction(units, entries, 1, '开机并网', { ...CTX, now: '2026-10-06 08:00' })
assert.ok(res.ok, res.message)
units = res.units
entries = res.entries
const boardAtRestart = domain.buildUnitBoard(units, entries, '2026-10-06 09:00')
const unit1 = boardAtRestart.items.find((i) => i.id === 1)
assert.equal(unit1.status, '运行中')
assert.equal(unit1.hours, beforeHours + 1, '重新并网后只补实际并网 1 小时，故障停机的 22 小时不得顺延')
assert.equal(boardAtRestart.stats.running, 2)
assert.equal(boardAtRestart.stats.fault, 1)

// 6) 重复并网拒绝
res = domain.applyUnitAction(units, entries, 1, '开机并网', { ...CTX, now: '2026-10-06 10:00' })
assert.ok(!res.ok)

// 7) 停机转备收口时段、备用容量回升
res = domain.applyUnitAction(units, entries, 4, '开机并网', { crew: '运行二班', operator: '李海峰', now: '2026-10-07 08:00' })
assert.ok(res.ok, res.message) // 4 号机故障修复并网
units = res.units; entries = res.entries
res = domain.applyUnitAction(units, entries, 4, '停机转备', { crew: '运行二班', operator: '李海峰', now: '2026-10-08 08:00' })
assert.ok(res.ok, res.message)
units = res.units; entries = res.entries
board = domain.buildUnitBoard(units, entries, '2026-10-08 08:00')
assert.equal(board.stats.standby, 4)
assert.equal(board.stats.standbyCapacity, 100, '4 号机转入备用后备用容量为 15+40+30+15=100MW')
assert.equal(board.stats.fault, 0)
const seg4 = entries.find((e) => e.unitId === 4 && e.startedAt === '2026-10-07 08:00')
assert.equal(seg4.hours, 24, '本次并网时段应恰好 24 小时')

// 8) 台账补记：先入库一稿为准，后到整套退回
const draft1 = {
  crew: '运行一班',
  submitter: '张志强',
  items: [{ unitId: 3, startedAt: '2026-05-01 08:00', endedAt: '2026-05-02 08:00' }],
}
let accepted = domain.acceptLedgerDraft(units, entries, batches, draft1, '2026-10-05 11:00')
assert.ok(accepted.ok, accepted.message)
entries = accepted.entries
batches = [accepted.batch, ...batches]
assert.equal(accepted.batch.entryIds.length, 1)

const draft2 = {
  crew: '运行二班',
  submitter: '赵敏',
  items: [{ unitId: 3, startedAt: '2026-05-01 08:00', endedAt: '2026-05-02 09:00' }],
}
let rejected = domain.acceptLedgerDraft(units, entries, batches, draft2, '2026-10-05 12:00')
assert.ok(!rejected.ok, '重复时段的后到批次必须整套退回')
assert.equal(rejected.batch.entryIds.length, 0)
batches = [rejected.batch, ...batches]
const unit3Hours = domain.hoursByUnit(entries, '2026-10-05 12:00').get(3)
const unit3HoursBase = domain.hoursByUnit(accepted.entries, '2026-10-05 11:00').get(3)
assert.equal(unit3Hours, unit3HoursBase, '退回批次不得影响台账小时')

// 9) 与已退回批次完全相同的重复提交只留一条。
//    先造一个因时间倒挂被退回的批次，再原样重提：应命中「重复提交只留一条」。
const invalidDraft = {
  crew: '运行一班',
  submitter: '张志强',
  items: [{ unitId: 5, startedAt: '2024-02-01 08:00', endedAt: '2024-02-01 06:00' }],
}
let invalid = domain.acceptLedgerDraft(units, entries, batches, invalidDraft, '2026-10-05 12:30')
assert.ok(!invalid.ok)
assert.match(invalid.reason, /早于或等于/)
batches = [invalid.batch, ...batches]
let repeated = domain.acceptLedgerDraft(units, entries, batches, invalidDraft, '2026-10-05 13:00')
assert.ok(!repeated.ok)
assert.equal(repeated.batch.duplicateOf, invalid.batch.id, '应标明指向此前内容相同的退回批次')
assert.match(repeated.reason, /重复提交只保留一条/)

// 10) 批内重复、倒挂时段都整套退回
let bad = domain.acceptLedgerDraft(
  units, entries, batches,
  { crew: '运行一班', submitter: '张志强', items: [
    { unitId: 3, startedAt: '2026-05-01 08:00', endedAt: '2026-05-02 08:00' },
    { unitId: 3, startedAt: '2026-05-01 08:00', endedAt: null },
  ] },
  '2026-10-05 14:00',
)
assert.ok(!bad.ok)
assert.match(bad.reason, /批内存在重复明细/)
bad = domain.acceptLedgerDraft(
  units, entries, batches,
  { crew: '运行一班', submitter: '张志强', items: [{ unitId: 3, startedAt: '2026-05-02 08:00', endedAt: '2026-05-01 08:00' }] },
  '2026-10-05 14:30',
)
assert.ok(!bad.ok)
assert.match(bad.reason, /早于或等于/)

// 11) 列表与看板同源：看板台数恒等于按 status 分组的计数
board = domain.buildUnitBoard(units, entries, '2026-10-08 08:00')
for (const status of ['运行中', '停机备用', '故障停机', '待启动']) {
  const fromRows = units.filter((u) => u.status === status).length
  const fromBoard = board.items.filter((i) => i.status === status).length
  assert.equal(fromRows, fromBoard, `${status} 列表计数与看板必须一致`)
}

// 12) 小时全部为非负数、备用容量只按停机备用机组口径
assert.ok(board.items.every((i) => i.hours >= 0))
const standbyCap = units
  .filter((u) => u.status === '停机备用')
  .reduce((s, u) => s + Number(u['有功出力']), 0)
assert.equal(board.stats.standbyCapacity, standbyCap)

console.log('全部 12 组领域规则断言通过 ✔')
console.log(`早年缺项 ${gaps.length} 条：`, gaps.map((g) => `${g.unitCode}→${g.closedAt}(${g.rule})`).join('，'))
console.log('最终看板：', board.stats)
