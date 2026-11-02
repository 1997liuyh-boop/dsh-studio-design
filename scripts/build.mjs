import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url)), dir = join(root, 'studios/design')
const project = JSON.parse(await readFile(join(dir, 'studio.json'), 'utf8'))
const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
await mkdir(join(dir, 'lib'), { recursive: true }); await mkdir(join(dir, 'static'), { recursive: true })
const css = async path => (await postcss([tailwind()]).process(await readFile(path, 'utf8'), { from: path })).css
await build({ entryPoints: [join(dir, 'src/index.ts')], outfile: join(dir, 'lib/index.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', define: { STUDIO_PROJECT: JSON.stringify(project) } })
await build({ entryPoints: [join(dir, 'src/client.tsx')], outfile: join(dir, 'lib/client.js'), bundle: true, platform: 'browser', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  define: { STUDIO_PROJECT: JSON.stringify(project), STUDIO_PROJECT_ORDER: String(project.order), STUDIO_CARD_CSS: JSON.stringify(await css(join(root, 'packages/sdk/card.css'))), DESIGN_CLIENT_CSS: JSON.stringify(await css(join(dir, 'src/client.css'))) },
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` }, footer: { js: 'return module.exports;}});' } })
await build({ entryPoints: [join(dir, 'src/main.ts')], outfile: join(dir, 'static/app.js'), bundle: true, platform: 'browser', format: 'esm', minify: true,
  define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  plugins: [{ name: 'vue-sfc', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
    const { descriptor, errors } = parse(await readFile(path, 'utf8'), { filename: path })
    if (errors.length) throw new Error(String(errors))
    return { contents: compileScript(descriptor, { id: 'studio-design', inlineTemplate: true }).content, loader: 'ts', resolveDir: dirname(path) }
  }) } }] })
await build({ entryPoints: [join(root, 'upstream/reborn/src/index.ts')], outfile: join(dir, 'lib/reborn-mcp.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" } })
await cp(join(root, 'upstream/reborn/knowledge'), join(dir, 'reborn/knowledge'), { recursive: true })
await cp(join(root, 'upstream/reborn/spec'), join(dir, 'reborn/spec'), { recursive: true })
await cp(join(root, 'upstream/reborn/LICENSE'), join(dir, 'reborn/LICENSE'))
await writeFile(join(dir, 'static/app.css'), await css(join(dir, 'src/style.css')))
await writeFile(join(dir, 'static/index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>设计工作室</title><link rel="stylesheet" href="/studio-projects/design/app.css"></head><body><div id="app"></div><script type="module" src="/studio-projects/design/app.js"></script></body></html>\n')
await writeFile(join(dir, 'dsh.plugin.json'), JSON.stringify({ name: pkg.name, version: pkg.version, description: project.description, entry: { name: pkg.name, inject: ['studioProjects', 'tools', 'sessions', 'agents', 'sessionProjections', 'systemPrompt'] }, client: { platform: 'web' } }, null, 2) + '\n')
console.log('设计工作室：Host、SDK 卡片、Vue 页面与内置 Reborn MCP 已构建')
