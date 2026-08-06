const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')
const ROOT = path.resolve(__dirname)
const NODE = process.execPath
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-check-'))
let failed = false
function checkJs(label, code) {
  const f = path.join(TMP, label.replace(/[^a-zA-Z0-9]/g, '_') + '.mjs')
  fs.writeFileSync(f, code)
  const r = spawnSync(NODE, ['--check', f], { encoding: 'utf8' })
  if (r.status === 0) console.log('  OK   ' + label)
  else { failed = true; console.log('  FAIL ' + label + ' -> ' + (r.stderr || r.stdout).trim().split('\n').pop()) }
}
const vueSrc = fs.readFileSync(path.join(ROOT, 'pages/index/index.vue'), 'utf8')
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g
let m, n = 0
while ((m = re.exec(vueSrc))) {
  n++
  checkJs('index.vue <script' + (m[1] ? ' ' + m[1].trim() : '') + '>', m[2])
}
if (n === 0) { failed = true; console.log('  FAIL vue') }
checkJs('utils/logger.js', fs.readFileSync(path.join(ROOT, 'utils/logger.js'), 'utf8'))
for (const f of ['manifest.json', 'pages.json']) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); console.log('  OK   ' + f) }
  catch (e) { failed = true; console.log('  FAIL ' + f + ' -> ' + e.message) }
}
console.log(failed ? '\n>>> 失败' : '\n>>> 全部通过')
process.exit(failed ? 1 : 0)
