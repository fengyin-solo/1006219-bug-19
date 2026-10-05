/* SSR 冒烟：真实渲染改动过的页面，捕获模板/脚本运行期错误。 */
import { build } from 'esbuild'
import { parse, compileTemplate, compileScript } from 'vue/compiler-sfc'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

const srcRoot = new URL('../src/', import.meta.url)
const frontendRoot = new URL('../', import.meta.url)
const dir = mkdtempSync(join(tmpdir(), 'ssr-'))

// .vue SFC 插件：编译成 SSR 用的 render 函数。
const sfcPlugin = {
  name: 'vue-ssr',
  setup(buildInstance) {
    buildInstance.onResolve({ filter: /\.vue$/ }, (args) => {
      const raw = args.path.startsWith('@/')
        ? join(srcRoot.pathname, args.path.slice(2))
        : resolvePath(args.resolveDir, args.path)
      return { path: raw, namespace: 'vue' }
    })
    buildInstance.onLoad({ filter: /.*/, namespace: 'vue' }, (args) => {
      const source = readFileSync(args.path, 'utf8')
      const { descriptor } = parse(source, { filename: args.path })
      const id = String(Math.random()).slice(2)
      const script = compileScript(descriptor, {
        id,
        inlineTemplate: true,
        templateOptions: { ssr: true },
      })
      return {
        contents: script.content,
        loader: 'ts',
        resolveDir: dirname(args.path),
      }
    })
  },
}

writeFileSync(join(dir, 'dom-shim.mjs'), `
const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
}
`)
writeFileSync(join(dir, 'pinia-shim.mjs'), `
export function defineStore() { return () => ({}) }
export function createPinia() { return {} }
`)
writeFileSync(join(dir, 'session-shim.mjs'), `
import { reactive } from 'vue'
export const CREWS = ['运行一班', '运行二班']
const state = reactive({ operator: '张志强', crew: '运行一班', shiftLabel: '白班' })
const store = {
  ...state,
  canOperate: true,
  setShift(l) { state.shiftLabel = l },
  switchCrew(c, o) { state.crew = c; state.operator = o },
}
export function useSessionStore() { return store }
`)

const pages = [
  ['Dashboard', '@/views/Dashboard.vue'],
  ['Unit', '@/views/unit/index.vue'],
  ['Generation', '@/views/generation/index.vue'],
  ['Crew', '@/views/crew/index.vue'],
]

for (const [name, pagePath] of pages) {
  const entry = join(dir, `${name}.mjs`)
  writeFileSync(entry, `
import './dom-shim.mjs'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Page from '${pagePath}'
export async function render() {
  const app = createSSRApp(defineComponent({
    components: { Page },
    render() { return h(Page) },
  }))
  return renderToString(app)
}
`)
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: join(dir, `${name}.bundle.mjs`),
    alias: {
      '@': srcRoot.pathname,
      'pinia': join(dir, 'pinia-shim.mjs'),
      '@/stores/session': join(dir, 'session-shim.mjs'),
    },
    logLevel: 'silent',
    plugins: [sfcPlugin],
    nodePaths: [new URL('node_modules', frontendRoot).pathname],
  })
}

const mustContain = {
  Dashboard: ['备用容量', '先入库', '可用机组', '跨年臆测'],
  Unit: ['并网时段台账', '补记并网台账', '值班清单', '整套退回'],
  Generation: ['可用机组', '同一数据源'],
  Crew: ['值班清单与机组并网台账联动'],
}

for (const [name] of pages) {
  const mod = await import(pathToFileURL(join(dir, `${name}.bundle.mjs`)).href)
  const html = await mod.render()
  if (!html || html.length < 200) {
    throw new Error(`${name} 渲染结果异常过短`)
  }
  for (const word of mustContain[name]) {
    if (!html.includes(word)) {
      throw new Error(`${name} 渲染结果缺少关键文案：${word}`)
    }
  }
  console.log(`✔ ${name} 渲染成功（${html.length} 字符）`)
}
console.log('SSR 冒烟全部通过')
