// 机组台账领域逻辑的回归测试：台数联动、小时推算、缺项封账、去重、越权、值班清单。
// 运行方式：npm test（先由 esbuild 打包成 node 可执行的 mjs）。
import assert from 'node:assert/strict'

import { listRows, resetRows } from '@/data/local-store'
import { listUnitEvents, resetUnitEvents } from '@/data/unit-events'
import {
  applyUnitAction,
  listDutyRoster,
  loadUnitBoard,
  summarizeUnits,
  syncUnitHours,
} from '@/api/unit-ledger'

const T = (value: string) => new Date(value).getTime()
const unitRow = (id: number) => listRows('unit').find((row) => Number(row.id) === id)!
const ctx = { operator: '值班管理员', crew: '运行一值' }

function resetAll() {
  resetRows('unit')
  resetUnitEvents()
}

// A. 历史回填：推算值覆盖手填旧值，早期缺停机记录按当日 24:00 封账并单列缺项
{
  resetAll()
  const gaps = syncUnitHours(T('2026-10-05T12:00:00'))
  // UNIT-0002：闭合段 58 + 26 + 43 = 127h（故障段 09-16 11:00 → 09-18 14:00 不计），
  // 开口段 09-28 08:00 → 10-05 12:00 = 172h，合计 299h；手填旧值 980 被覆盖。
  assert.equal(unitRow(2)['累计运行小时'], 299)
  // UNIT-0003：缺项封账 16.5h + 57h = 73.5h；手填旧值 120 被覆盖。
  assert.equal(unitRow(3)['累计运行小时'], 73.5)
  // UNIT-0001：无并网记录，0h。
  assert.equal(unitRow(1)['累计运行小时'], 0)
  // 缺项只有 UNIT-0003 的 2026-08-05 开机记录一条，且按 24:00 封账规则说明。
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].机组编号, 'UNIT-0003')
  assert.equal(gaps[0].记录时间, '2026-08-05T07:30:00')
  assert.match(gaps[0].rule, /24:00/)
  // pending/abnormal 标志按状态归一：运行中不再挂异常，故障/待启动才算待处理。
  assert.equal(unitRow(2).abnormal, false)
  assert.equal(unitRow(1).pending, true)
  console.log('A 历史回填与缺项封账 ✓')
}

// B. 登记故障：运行中/备用/故障台数一起联动，重复登记只算一次
{
  resetAll()
  syncUnitHours(T('2026-10-05T12:00:00'))
  const before = summarizeUnits()
  assert.deepEqual([before.running, before.standby, before.fault], [1, 1, 0])

  const result = applyUnitAction(2, '登记故障', { ...ctx, at: '2026-10-05T13:00:00' })
  assert.equal(result.ok, true)
  const after = summarizeUnits()
  assert.deepEqual([after.running, after.standby, after.fault], [0, 1, 1])
  // 列表状态与看板台数对得上
  assert.equal(unitRow(2).status, '故障停机')
  // 故障时刻封账：127 + (09-28 08:00 → 10-05 13:00 = 173h) = 300h
  assert.equal(unitRow(2)['累计运行小时'], 300)

  // 同一台机组重复登记故障：退回，台数不再扣，事件不新增
  const faultCount = () => listUnitEvents(2).filter((e) => e.动作 === '登记故障').length
  assert.equal(faultCount(), 2) // 种子 1 条 + 本次 1 条
  const dup = applyUnitAction(2, '登记故障', { ...ctx, at: '2026-10-05T14:00:00' })
  assert.equal(dup.ok, false)
  assert.match(dup.message, /重复登记/)
  assert.equal(faultCount(), 2)
  const again = summarizeUnits()
  assert.deepEqual([again.running, again.standby, again.fault], [0, 1, 1])
  console.log('B 故障台数联动与重复登记幂等 ✓')
}

// C. 故障后重新并网：小时数按实际并网时段补记，不整段顺延
{
  const restart = applyUnitAction(2, '开机并网', { ...ctx, crew: '运行二值', at: '2026-10-08T09:00:00' })
  assert.equal(restart.ok, true)
  // 故障段 10-05 13:00 → 10-08 09:00 不计小时，重并网瞬间仍是 300h
  assert.equal(unitRow(2)['累计运行小时'], 300)
  // 到 10-08 12:00 只多 3h（开口段）；若整段顺延会算出 371h
  syncUnitHours(T('2026-10-08T12:00:00'))
  assert.equal(unitRow(2)['累计运行小时'], 303)
  console.log('C 重新并网按实际时段补记 ✓')
}

// D. 重复提交：同机组同动作同一分钟只留最先入库的一条，后到整套退回
{
  resetAll()
  const first = applyUnitAction(2, '登记故障', { ...ctx, at: '2026-10-05T13:00:00' })
  assert.equal(first.ok, true)
  const restart = applyUnitAction(2, '开机并网', { ...ctx, at: '2026-10-06T08:00:00' })
  assert.equal(restart.ok, true)
  // 与 first 同机组、同动作、同一分钟的再次提交：重复，整套退回
  const dup = applyUnitAction(2, '登记故障', { ...ctx, at: '2026-10-05T13:00:30' })
  assert.equal(dup.ok, false)
  assert.match(dup.message, /重复提交/)
  const kept = listUnitEvents(2).filter(
    (e) => e.动作 === '登记故障' && e.记录时间.startsWith('2026-10-05T13:00'),
  )
  assert.equal(kept.length, 1)
  // 整套退回：台账状态不被这次重复提交改动
  assert.equal(unitRow(2).status, '运行中')
  console.log('D 重复提交只留一条 ✓')
}

// E. 越权：替别的班组提交的，一律拒绝，什么都不写
{
  resetAll()
  const denied = applyUnitAction(2, '登记故障', {
    ...ctx,
    onBehalfOfCrew: '运行二值',
    at: '2026-10-05T13:00:00',
  })
  assert.equal(denied.ok, false)
  assert.match(denied.message, /越权/)
  assert.equal(unitRow(2).status, '运行中')
  assert.equal(listUnitEvents(2).filter((e) => e.记录时间.startsWith('2026-10-05')).length, 0)
  console.log('E 越权提交拒绝 ✓')
}

// F. 状态机：不允许的流转直接退回
{
  resetAll()
  const standby = applyUnitAction(1, '停机转备', { ...ctx, at: '2026-10-05T13:00:00' })
  assert.equal(standby.ok, false) // 待启动不能转备
  const fault = applyUnitAction(1, '登记故障', { ...ctx, at: '2026-10-05T13:00:00' })
  assert.equal(fault.ok, false) // 待启动不能登记故障
  assert.equal(unitRow(1).status, '待启动')
  console.log('F 非法流转退回 ✓')
}

// G. 值班清单：只看得到本班组记录，状态与台账联动
{
  resetAll()
  applyUnitAction(2, '登记故障', { ...ctx, at: '2026-10-05T13:00:00' })
  const own = listDutyRoster('运行一值')
  assert.equal(own.length, 7) // 种子一值 6 条 + 本次 1 条
  assert.ok(own.every((item) => item.event.值班班组 === '运行一值'))
  const other = listDutyRoster('运行二值')
  assert.equal(other.length, 4) // 种子二值 4 条
  assert.ok(other.every((item) => item.event.值班班组 === '运行二值'))
  // 联动：清单里的机组状态就是台账当前状态
  const entry = own.find((item) => item.event.记录时间.startsWith('2026-10-05T13:00'))!
  assert.equal(entry.status, '故障停机')
  assert.equal(entry.status, unitRow(2).status)
  console.log('G 值班清单班组隔离与台账联动 ✓')
}

// H. 可用台数口径：运行中＋停机备用，总览与发电计划页同源同数
{
  resetAll()
  syncUnitHours(T('2026-10-05T12:00:00'))
  const summary = summarizeUnits()
  const board = loadUnitBoard()
  assert.equal(summary.available, summary.running + summary.standby)
  assert.equal(board.summary.available, summary.available)
  assert.equal(board.summary.running, 1)
  assert.equal(board.summary.standby, 1)
  assert.equal(board.summary.fault, 0)
  console.log('H 可用台数同源一致 ✓')
}

// I. 停机备用机组登记故障：备用台数回落、故障台数上升，不误判缺开机记录
{
  resetAll()
  syncUnitHours(T('2026-10-05T12:00:00'))
  const result = applyUnitAction(3, '登记故障', { ...ctx, at: '2026-10-05T15:00:00' })
  assert.equal(result.ok, true)
  assert.equal(unitRow(3).status, '故障停机')
  const summary = summarizeUnits()
  assert.deepEqual([summary.running, summary.standby, summary.fault], [1, 0, 1])
  // 备用机组没有开口段可合：小时数不变，缺项也不新增
  assert.equal(unitRow(3)['累计运行小时'], 73.5)
  const gaps = syncUnitHours(T('2026-10-05T16:00:00'))
  assert.equal(gaps.length, 1) // 仍只有 2026-08-05 那一条早期缺项
  console.log('I 备用机组故障不误判缺项 ✓')
}

console.log('全部机组台账测试通过')
