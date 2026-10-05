<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">机组运行明细</h3>
    <div class="stat-row">
      <article v-for="card in unitCards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>机组编号</th><th>机组型号</th><th>当前状态</th><th>累计运行小时</th><th>最近事件</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in unitRows" :key="row.id">
          <td>{{ row.机组编号 }}</td>
          <td>{{ row.机组型号 }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.累计运行小时 }}</td>
          <td>{{ row.最近事件 }}</td>
        </tr>
        <tr v-if="!unitRows.length">
          <td colspan="5" class="empty-state">暂无机组台账数据</td>
        </tr>
      </tbody>
    </table>
    <div v-if="unitGaps.length" class="gap-notes">
      <h4 class="gap-title">早期记录缺项说明</h4>
      <p v-for="(note, index) in unitGaps" :key="index" class="gap-item">
        {{ note.机组编号 }} · {{ note.记录时间 }}：{{ note.rule }}
      </p>
    </div>

    <h3 class="section-title">各业务模块</h3>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
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

import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const unitBoard = ref<OverviewResult['unitBoard']>({ summary: { total: 0, running: 0, standby: 0, fault: 0, pendingStart: 0, available: 0 }, rows: [], gaps: [] })

const unitCards = computed(() => [
  { label: '运行中机组', value: unitBoard.value.summary.running },
  { label: '停机备用机组', value: unitBoard.value.summary.standby },
  { label: '故障停机机组', value: unitBoard.value.summary.fault },
  { label: '可用机组台数', value: unitBoard.value.summary.available },
])
const unitRows = computed(() => unitBoard.value.rows)
const unitGaps = computed(() => unitBoard.value.gaps)

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  unitBoard.value = payload.unitBoard
}

onMounted(refresh)
</script>

<style scoped>
.section-title { margin: 18px 0 10px; font-size: 15px; }
.gap-notes { margin: 10px 0 4px; padding: 10px 12px; background: #fff8e6; border: 1px solid #f0d489; border-radius: 8px; }
.gap-title { margin: 0 0 6px; font-size: 13px; }
.gap-item { margin: 4px 0; font-size: 12px; color: #7a5d00; }
</style>
