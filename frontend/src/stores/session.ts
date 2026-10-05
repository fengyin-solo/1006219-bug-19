import { defineStore } from 'pinia'

export const CREWS = ['运行一班', '运行二班'] as const

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '张志强',
    crew: '运行一班',
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
    // 值班清单与台账都按班组隔离：切换班组即切换值班视角，只看得到属于自己的记录。
    switchCrew(crew: string, operator: string) {
      this.crew = crew
      this.operator = operator
    },
  },
})
