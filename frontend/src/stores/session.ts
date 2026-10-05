import { defineStore } from 'pinia'

// 当前值班会话：操作员 + 值班班组。机组动作按这里的班组入账，
// 值班清单只显示本班组记录，替别的班组代交一律被拒绝。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    crew: '运行一值',
    crewOptions: ['运行一值', '运行二值', '运行三值'],
    shiftLabel: '白班 08:00-20:00',
    scope: '水电站机组运行检修管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setCrew(crew: string) {
      this.crew = crew
    },
  },
})
