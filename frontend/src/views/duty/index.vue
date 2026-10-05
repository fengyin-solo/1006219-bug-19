<template>
  <section class="page" data-module="duty">
    <header class="page-head">
      <div>
        <h2>值班清单</h2>
        <p class="page-desc">
          只列出本班组「{{ store.crew }}」的值班记录；机组状态与累计运行小时直接取机组台账当前值，与台账联动。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新</button>
      </div>
    </header>

    <table class="data-table">
      <thead>
        <tr>
          <th>记录时间</th>
          <th>机组编号</th>
          <th>动作</th>
          <th>提交人</th>
          <th>值班班组</th>
          <th>机组当前状态</th>
          <th>累计运行小时</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.event.id">
          <td>{{ item.event.记录时间 }}</td>
          <td>{{ item.event.机组编号 }}</td>
          <td>{{ item.event.动作 }}</td>
          <td>{{ item.event.提交人 }}</td>
          <td>{{ item.event.值班班组 }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.hours }}</td>
        </tr>
        <tr v-if="!items.length">
          <td colspan="7" class="empty-state">本班组暂无值班记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ items.length }} 条本班组值班记录</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

import { listDutyRoster } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const items = ref<ReturnType<typeof listDutyRoster>>([])

function reload() {
  items.value = listDutyRoster(store.crew)
}

// 切换班组后只看得到对应班组自己的记录。
watch(() => store.crew, reload)
onMounted(reload)
</script>
