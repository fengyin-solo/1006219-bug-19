// 极简 ESM loader：让 node 直接跑 TS 测试，解析 @/ 别名与省略扩展名的相对导入。
// 仓库里的 esbuild 是 darwin 二进制跑不了，这里改用 typescript 包的 transpileModule。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transpileModule } from 'typescript'

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const url = pathToFileURL(path.join(srcRoot, `${specifier.slice(2)}.ts`)).href
    return { url, shortCircuit: true }
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await next(specifier, context)
    } catch {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd()
      const url = pathToFileURL(`${path.resolve(path.dirname(parent), specifier)}.ts`).href
      return { url, shortCircuit: true }
    }
  }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.endsWith('.ts')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const { outputText } = transpileModule(source, {
      compilerOptions: { module: 'ESNext', target: 'ES2020' },
      fileName: url,
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return next(url, context)
}
