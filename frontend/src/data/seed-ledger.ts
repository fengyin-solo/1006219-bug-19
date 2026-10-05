import type { GridLedgerEntry, LedgerBatch } from './types'

/**
 * 并网台账种子数据。
 * 早期机组只留了开机时间、停机时间缺失：这里按原样播种为开口时段，
 * 首次读取时由 reconcileLedger 按裁决规则收口并在总览逐条列明，不在这里直接补。
 */

const ENTRIES_TEMPLATE: Omit<GridLedgerEntry, 'id'>[] = [
  // 1 号机：当前运行中，最近一段保持开口，实时累计
  {
    unitId: 1, unitCode: 'UNIT-0001',
    startedAt: '2026-09-20 08:00', endedAt: null, hours: null,
    source: '事件记录', note: '开机并网', crew: '运行一班', submitter: '张志强',
    recordTime: '2026-09-20 08:00', batchId: 0,
  },
  {
    unitId: 1, unitCode: 'UNIT-0001',
    startedAt: '2026-08-18 08:00', endedAt: '2026-08-28 20:00', hours: 252,
    source: '事件记录', note: '开机并网；停机转备收口', crew: '运行一班', submitter: '张志强',
    recordTime: '2026-08-28 20:00', batchId: 0,
  },
  // 2 号机：当前运行中
  {
    unitId: 2, unitCode: 'UNIT-0002',
    startedAt: '2026-10-01 00:00', endedAt: null, hours: null,
    source: '事件记录', note: '故障修复后重新并网（新时段）', crew: '运行二班', submitter: '李海峰',
    recordTime: '2026-10-01 00:00', batchId: 0,
  },
  {
    unitId: 2, unitCode: 'UNIT-0002',
    startedAt: '2026-09-10 08:00', endedAt: '2026-09-30 16:00', hours: 488,
    source: '事件记录', note: '开机并网；故障解列收口', crew: '运行二班', submitter: '李海峰',
    recordTime: '2026-09-30 16:00', batchId: 0,
  },
  // 3 号机：停机备用，最近一段已收口
  {
    unitId: 3, unitCode: 'UNIT-0003',
    startedAt: '2026-09-01 08:00', endedAt: '2026-09-15 20:00', hours: 348,
    source: '事件记录', note: '开机并网；停机转备收口', crew: '运行一班', submitter: '王建国',
    recordTime: '2026-09-15 20:00', batchId: 0,
  },
  {
    unitId: 3, unitCode: 'UNIT-0003',
    startedAt: '2026-08-01 08:00', endedAt: '2026-08-20 08:00', hours: 456,
    source: '事件记录', note: '开机并网；停机转备收口', crew: '运行一班', submitter: '王建国',
    recordTime: '2026-08-20 08:00', batchId: 0,
  },
  // 4 号机：当前故障停机，最近并网时段已在故障时刻收口，故障区间不计时
  {
    unitId: 4, unitCode: 'UNIT-0004',
    startedAt: '2026-09-25 08:00', endedAt: '2026-10-02 10:00', hours: 170,
    source: '事件记录', note: '开机并网；故障解列收口', crew: '运行二班', submitter: '李海峰',
    recordTime: '2026-10-02 10:00', batchId: 0,
  },
  {
    unitId: 4, unitCode: 'UNIT-0004',
    startedAt: '2026-07-01 08:00', endedAt: '2026-07-20 08:00', hours: 456,
    source: '事件记录', note: '开机并网；停机转备收口', crew: '运行二班', submitter: '李海峰',
    recordTime: '2026-07-20 08:00', batchId: 0,
  },
  // 5 号机：待启动的老机组。早年（2020 年）只登记了开机时间、缺停机时间，
  // 2021 年又有新并网，按裁决规则收口到下一条记录时刻。
  {
    unitId: 5, unitCode: 'UNIT-0005',
    startedAt: '2021-03-01 08:00', endedAt: '2021-09-10 18:00', hours: 4666,
    source: '事件记录', note: '开机并网；停机转备收口', crew: '运行一班', submitter: '王建国',
    recordTime: '2021-09-10 18:00', batchId: 0,
  },
  {
    unitId: 5, unitCode: 'UNIT-0005',
    startedAt: '2020-06-01 08:00', endedAt: null, hours: null,
    source: '事件记录', note: '开机并网（停机时间缺失）', crew: '运行一班', submitter: '王建国',
    recordTime: '2020-06-01 08:00', batchId: 0,
  },
  // 6 号机：停机备用的老机组。最早一条 2019 年开机后再无记录，
  // 按裁决规则封到开机年度年末，并在总览单列说明。
  {
    unitId: 6, unitCode: 'UNIT-0006',
    startedAt: '2022-05-10 08:00', endedAt: '2023-01-15 10:00', hours: 5978,
    source: '事件记录', note: '开机并网；停机转备收口', crew: '运行二班', submitter: '李海峰',
    recordTime: '2023-01-15 10:00', batchId: 0,
  },
  {
    unitId: 6, unitCode: 'UNIT-0006',
    startedAt: '2022-01-20 08:00', endedAt: '2022-03-10 08:00', hours: 1176,
    source: '事件记录', note: '开机并网；停机转备收口', crew: '运行二班', submitter: '李海峰',
    recordTime: '2022-03-10 08:00', batchId: 0,
  },
  {
    unitId: 6, unitCode: 'UNIT-0006',
    startedAt: '2019-11-01 08:00', endedAt: null, hours: null,
    source: '事件记录', note: '开机并网（停机时间缺失，其后无记录）', crew: '运行二班', submitter: '李海峰',
    recordTime: '2019-11-01 08:00', batchId: 0,
  },
  // 7 号机：退役转备的老机组，台账里仅留 2018 年一条开机记录、再无后续，
  // 按裁决规则封到开机年度年末。
  {
    unitId: 7, unitCode: 'UNIT-0007',
    startedAt: '2018-05-03 08:00', endedAt: null, hours: null,
    source: '事件记录', note: '开机并网（停机时间缺失，其后无记录）', crew: '运行一班', submitter: '王建国',
    recordTime: '2018-05-03 08:00', batchId: 0,
  },
  // 已受理批次 #1：运行一班补记的一段历史时段
  {
    unitId: 3, unitCode: 'UNIT-0003',
    startedAt: '2026-06-01 08:00', endedAt: '2026-06-10 20:00', hours: 228,
    source: '台账提交', note: '补记并网时段', crew: '运行一班', submitter: '张志强',
    recordTime: '2026-09-16 09:30', batchId: 1,
  },
]

export const LEDGER_SEED_ENTRIES: GridLedgerEntry[] = ENTRIES_TEMPLATE.map((entry, index) => ({
  ...entry,
  id: index + 1,
}))

export const LEDGER_SEED_BATCHES: LedgerBatch[] = [
  {
    id: 1,
    crew: '运行一班',
    submitter: '张志强',
    submittedAt: '2026-09-16 09:30',
    accepted: true,
    reason: '',
    entryIds: LEDGER_SEED_ENTRIES.filter((entry) => entry.batchId === 1).map((entry) => entry.id),
    draftCount: 1,
    duplicateOf: null,
    signature: '3|2026-06-01 08:00|2026-06-10 20:00',
  },
  {
    id: 2,
    crew: '运行二班',
    submitter: '赵敏',
    submittedAt: '2026-09-18 14:10',
    accepted: false,
    reason: '与先入库一稿重复，整套退回（重复提交只留一条）',
    entryIds: [],
    draftCount: 1,
    duplicateOf: 1,
    signature: '3|2026-06-01 08:00|2026-06-10 20:00',
  },
]
