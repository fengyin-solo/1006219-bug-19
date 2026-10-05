<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标；机组运行台数、并网明细与历史回填规则在这里一屏对齐。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <h3 class="section-title">机组运行看板（全厂口径，与机组列表、发电计划台账同源）</h3>
    <div class="stat-row">
      <article v-for="card in boardCards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <p class="status-legend">
      <span v-for="item in boardRowSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="ledger-block">
      <h3>并网运行明细（按记录时间排列，当前为{{ store.crew }}视角）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>机组编号</th><th>并网时刻</th><th>解列时刻</th><th>时长(h)</th>
            <th>来源</th><th>班组/提交人</th><th>记录时间</th><th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.id">
            <td>{{ entry.unitCode }}</td>
            <td>{{ entry.startedAt }}</td>
            <td>{{ entry.endedAt ?? '运行中' }}</td>
            <td>{{ entry.endedAt === null ? openHours(entry.startedAt) : entry.hours }}</td>
            <td>{{ entry.source }}</td>
            <td>{{ entry.crew }} / {{ entry.submitter }}</td>
            <td>{{ entry.recordTime }}</td>
            <td>{{ entry.note }}</td>
          </tr>
          <tr v-if="!entries.length">
            <td colspan="8" class="empty-state">本班暂无并网明细</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="ledger-block">
      <h3>早年缺项补记说明（只有开机时间、没有停机时间）</h3>
      <p class="page-desc">
        存量台账按记录时间回填。裁决规则：①同一机组其后还有并网记录的，收口到<strong>下一条并网记录时刻</strong>；
        ②其后再无记录的，封到<strong>开机当年 12-31 23:59</strong>，不跨年臆测，待凭证核实后更正。
      </p>
      <table class="data-table">
        <thead>
          <tr><th>机组编号</th><th>原开机时刻</th><th>收口时刻</th><th>补记时长(h)</th><th>适用规则</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="gap in gaps" :key="`${gap.unitId}-${gap.startedAt}`">
            <td>{{ gap.unitCode }}</td>
            <td>{{ gap.startedAt }}</td>
            <td>{{ gap.closedAt }}</td>
            <td>{{ gap.hours }}</td>
            <td>{{ gap.rule === 'next-event' ? '收口到下一条记录' : '封到年度年末' }}</td>
            <td>{{ gap.note }}</td>
          </tr>
          <tr v-if="!gaps.length">
            <td colspan="6" class="empty-state">无早年缺项</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="ledger-block rules-block">
      <h3>取值口径与裁决理由</h3>
      <ul>
        <li>
          <strong>累计运行小时取值：并网时段明细重算优先，旧字段保底。</strong>
          明细来自实际开机并网与停机/故障解列时刻，是可逐段核对的一手凭证；故障停机区间不开时段，
          修复后重新并网按新时段起记，不会把故障那段顺延进小时数。机组自带的累计字段仅对
          「查不到任何并网明细」的历史机组保底沿用，并在导出清单中随重算结果同步更新。
        </li>
        <li>
          <strong>可用机组台数 = 运行中 + 停机备用。</strong>
          故障停机不可立刻投入、待启动尚未具备并网条件，均不计入；该数字与发电计划台账页面完全相同。
        </li>
        <li>
          <strong>重复登记故障只算一次。</strong>同一台机组故障未消除前再次登记直接拒绝，运行台数、故障台数不重复扣减。
        </li>
        <li>
          <strong>补记台账以最先入库的一稿为准。</strong>同一机组同一并网时刻视为同一时段，后到的整套退回并留痕；
          与已退回批次完全相同的重复提交只保留一条退回记录。
        </li>
        <li>
          <strong>班组隔离。</strong>越权替别的班组登记一律拒绝；明细、批次、值班清单都只显示本班记录，
          全厂台数看板不受隔离影响。
        </li>
      </ul>
    </section>

    <h3 class="section-title">各业务模块汇总</h3>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记数</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  getGapNotes,
  getLedgerEntries,
  getUnitBoard,
  loadOverview,
} from '@/api/local-service'
import { formatTime, hoursBetween } from '@/data/unit-ledger'
import { useSessionStore } from '@/stores/session'
import type { GapNote, GridLedgerEntry, OverviewResult, UnitBoard } from '@/data/types'

const store = useSessionStore()
const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const board = ref<UnitBoard>({
  stats: { total: 0, running: 0, standby: 0, standbyCapacity: 0, fault: 0, pendingStart: 0, available: 0 },
  items: [],
})
const entries = ref<GridLedgerEntry[]>([])
const gaps = ref<GapNote[]>([])

const boardCards = computed(() => [
  { label: '运行中机组', value: board.value.stats.running },
  { label: '备用机组', value: board.value.stats.standby },
  { label: '备用容量(MW)', value: board.value.stats.standbyCapacity },
  { label: '故障机组', value: board.value.stats.fault },
  { label: '可用机组(运行+备用)', value: board.value.stats.available },
  { label: '机组总台数', value: board.value.stats.total },
])

const boardRowSummary = computed(() =>
  ['运行中', '停机备用', '故障停机', '待启动'].map((status) => ({
    status,
    count: board.value.items.filter((item) => item.status === status).length,
  })),
)

function openHours(startedAt: string): number {
  return hoursBetween(startedAt, formatTime(new Date()))
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  board.value = getUnitBoard()
  entries.value = getLedgerEntries(true)
  gaps.value = getGapNotes()
}

onMounted(refresh)
</script>
