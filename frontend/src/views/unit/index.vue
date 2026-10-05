<template>
  <section class="page" data-module="unit">
    <header class="page-head">
      <div>
        <h2>机组运行管理</h2>
        <p class="page-desc">
          登记开机并网、停机转备与故障登记。运行台数、备用容量、故障台数与累计运行小时全部由并网时段台账实时派生，列表与看板同源。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出机组运行清单</button>
        <button class="btn" type="button" @click="exportLedger">导出并网台账明细</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item note">台数口径：与运营概览、发电计划台账完全一致</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '累计运行小时'">{{ boardHours(row.id) }} h</template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无机组运行数据</td>
        </tr>
      </tbody>
    </table>

    <section class="ledger-block">
      <h3>并网时段台账（{{ store.crew }}视角，仅本班记录）</h3>
      <p class="page-desc">
        小时取值优先级：<strong>以并网时段明细重算为准</strong>，机组自带的「累计运行小时」字段只作无明细历史机组的保底；
        故障停机区间不开时段，重新并网按新时段起记，不再整段顺延。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>机组编号</th><th>并网时刻</th><th>解列时刻</th><th>时长(h)</th>
            <th>来源</th><th>提交班组/人</th><th>记录时间</th><th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledgerEntries" :key="entry.id">
            <td>{{ entry.unitCode }}</td>
            <td>{{ entry.startedAt }}</td>
            <td>{{ entry.endedAt ?? '运行中（实时累计）' }}</td>
            <td>{{ entry.endedAt === null ? openHours(entry.startedAt) : entry.hours }}</td>
            <td>{{ entry.source }}</td>
            <td>{{ entry.crew }} / {{ entry.submitter }}</td>
            <td>{{ entry.recordTime }}</td>
            <td>{{ entry.note }}</td>
          </tr>
          <tr v-if="!ledgerEntries.length">
            <td colspan="8" class="empty-state">本班暂无并网时段记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="ledger-block">
      <h3>补记并网台账</h3>
      <p class="page-desc">
        整套提交、整套受理或整套退回；同一机组同一并网时刻重复提交，以最先入库一稿为准。
        提交人须在本班值班清单内，替别的班组提交一律拒绝。
      </p>
      <div v-for="(item, index) in draftItems" :key="index" class="draft-row">
        <label class="filter-item">
          <span>机组</span>
          <select v-model.number="item.unitId">
            <option v-for="unit in unitOptions" :key="unit.id" :value="unit.id">{{ unit.code }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>并网时刻</span>
          <input v-model="item.startedAt" placeholder="YYYY-MM-DD HH:mm" />
        </label>
        <label class="filter-item">
          <span>解列时刻（留空=仍在并网）</span>
          <input v-model="item.endedAt" placeholder="YYYY-MM-DD HH:mm" />
        </label>
        <button class="btn ghost" type="button" @click="removeDraft(index)">删一条</button>
      </div>
      <div class="draft-actions">
        <button class="btn" type="button" @click="addDraft">再加一条</button>
        <label class="filter-item">
          <span>提交人（值班清单）</span>
          <select v-model="draftSubmitter">
            <option v-for="person in roster" :key="person.id" :value="String(person['姓名'])">
              {{ person['姓名'] }}（{{ person['岗位'] }}）
            </option>
          </select>
        </label>
        <button class="btn primary" type="button" @click="submitDraft">整套提交（{{ store.crew }}）</button>
      </div>
      <p v-if="!roster.length" class="error-text">本班值班清单为空（无在场人员），台账提交已联动关闭。</p>
      <p v-if="submitMessage" :class="submitOk ? 'ok-text' : 'error-text'">{{ submitMessage }}</p>
    </section>

    <section class="ledger-block">
      <h3>提交受理留痕</h3>
      <table class="data-table">
        <thead>
          <tr><th>批次</th><th>提交时间</th><th>提交人</th><th>明细数</th><th>结论</th><th>裁决说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.id">
            <td>#{{ batch.id }}</td>
            <td>{{ batch.submittedAt }}</td>
            <td>{{ batch.submitter }}</td>
            <td>{{ batch.draftCount }}</td>
            <td :class="batch.accepted ? 'ok-text' : 'error-text'">
              {{ batch.accepted ? '整套受理' : '整套退回' }}
            </td>
            <td>{{ batch.reason || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="ledger-block">
      <h3>{{ store.crew }}值班清单（在场人员）</h3>
      <p class="page-desc">值班清单与台账联动：人员办理离场后即从清单剔除，不能再作为提交人登记台账。</p>
      <table class="data-table">
        <thead>
          <tr><th>人员编号</th><th>姓名</th><th>岗位</th><th>持证类型</th><th>证书有效期</th><th>在场状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="person in roster" :key="person.id">
            <td>{{ person['人员编号'] }}</td>
            <td>{{ person['姓名'] }}</td>
            <td>{{ person['岗位'] }}</td>
            <td>{{ person['持证类型'] }}</td>
            <td>{{ person['证书有效期'] }}</td>
            <td>{{ person['在场状态'] }}</td>
          </tr>
          <tr v-if="!roster.length">
            <td colspan="6" class="empty-state">本班当前无在场人员</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条机组运行记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getDutyRoster,
  getLedgerBatches,
  getLedgerEntries,
  getUnitBoard,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitLedgerDraft,
} from '@/api/local-service'
import { formatTime, hoursBetween } from '@/data/unit-ledger'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, GridLedgerEntry, LedgerBatch, UnitBoard } from '@/data/types'

const meta = moduleMeta('unit')
const store = useSessionStore()
const columns = ["机组编号", "机组型号", "额定转速", "有功出力", "无功出力", "累计运行小时", "振动数值", "运行状态"]
const actions = ["开机并网", "停机转备", "登记故障"]
const statuses = ["待启动", "运行中", "停机备用", "故障停机"]

const rows = ref<EntryRow[]>([])
const board = ref<UnitBoard>({
  stats: { total: 0, running: 0, standby: 0, standbyCapacity: 0, fault: 0, pendingStart: 0, available: 0 },
  items: [],
})
const ledgerEntries = ref<GridLedgerEntry[]>([])
const batches = ref<LedgerBatch[]>([])
const roster = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const draftItems = ref([{ unitId: 1, startedAt: '', endedAt: '' }])
const draftSubmitter = ref('')
const submitMessage = ref('')
const submitOk = ref(false)

const statCards = computed(() => [
  { label: '运行中机组', value: board.value.stats.running },
  { label: '备用机组', value: board.value.stats.standby },
  { label: '备用容量(MW)', value: board.value.stats.standbyCapacity },
  { label: '故障机组', value: board.value.stats.fault },
  { label: '可用机组(运行+备用)', value: board.value.stats.available },
  { label: '待启动机组', value: board.value.stats.pendingStart },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: board.value.items.filter((item) => item.status === status).length,
  })),
)

const unitOptions = computed(() =>
  board.value.items.map((item) => ({ id: item.id, code: item.code })),
)

function boardHours(id: number): number {
  return board.value.items.find((item) => item.id === Number(id))?.hours ?? 0
}

function openHours(startedAt: string): number {
  return hoursBetween(startedAt, formatTime(new Date()))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function addDraft() {
  draftItems.value.push({ unitId: draftItems.value[0]?.unitId ?? 1, startedAt: '', endedAt: '' })
}

function removeDraft(index: number) {
  draftItems.value.splice(index, 1)
}

function exportRows() {
  downloadEntries(meta.key)
}

function exportLedger() {
  const header = ['机组编号', '并网时刻', '解列时刻', '时长(h)', '来源', '提交班组', '提交人', '记录时间', '说明']
  const lines = [header.join(',')]
  for (const entry of ledgerEntries.value) {
    lines.push([
      entry.unitCode, entry.startedAt, entry.endedAt ?? '',
      entry.endedAt === null ? openHours(entry.startedAt) : entry.hours,
      entry.source, entry.crew, entry.submitter, entry.recordTime, entry.note,
    ].join(','))
  }
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${store.crew}-并网台账明细.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function submitDraft() {
  submitMessage.value = ''
  const items = draftItems.value.map((item) => ({
    unitId: item.unitId,
    startedAt: item.startedAt.trim(),
    endedAt: item.endedAt.trim() === '' ? null : item.endedAt.trim(),
  }))
  const result = submitLedgerDraft({
    crew: store.crew,
    submitter: draftSubmitter.value,
    items,
  })
  submitOk.value = result.ok
  submitMessage.value = result.message
  if (result.ok) {
    draftItems.value = [{ unitId: draftItems.value[0]?.unitId ?? 1, startedAt: '', endedAt: '' }]
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    board.value = getUnitBoard()
    ledgerEntries.value = getLedgerEntries(true)
    batches.value = getLedgerBatches(true)
    roster.value = getDutyRoster()
    if (!draftSubmitter.value && roster.value.length) {
      draftSubmitter.value = String(roster.value[0]['姓名'])
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '机组运行列表读取失败'
  }
}

onMounted(reload)
</script>
