#!/usr/bin/env node
/* ============================================================
   规则回归脚本：Node 实跑 static/js/manju-rules.js，
   与 docs/samples/translit 的样例逐字节对比。

   用途：manju-rules.js 是 /translit/ 与 /translate/ 共用的唯一规则来源，
   改动规则后跑一次，确认没有破坏既有转写行为。

   用法：
       node scripts/verify_manju_rules.js
   退出码：0 全部通过，1 存在不一致
   依赖：Node 14+
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SAMPLES = path.join(ROOT, 'docs', 'samples', 'translit');

// 用最小 window 沙箱加载规则文件
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'static', 'js', 'manju-rules.js'), 'utf8'),
    sandbox
);
const R = sandbox.window.ManjuRules;

if (!R || !R.manju2latin) {
    console.error('[FAIL] 规则未挂载到 window.ManjuRules');
    process.exit(1);
}
console.log('规则条目：满文→拉丁', R.MANJU_TO_LATIN_RULES.length,
            '| 拉丁→满文', R.LATIN_TO_MANJU_RULES.length);

let fail = 0;
function cmp(label, got, want) {
    if (got === want) {
        console.log('  [OK]  ', label);
    } else {
        fail++;
        console.log('  [FAIL]', label);
        console.log('     got :', JSON.stringify(got.slice(0, 120)));
        console.log('     want:', JSON.stringify(want.slice(0, 120)));
    }
}

function read(p) {
    if (!fs.existsSync(p)) {
        console.error('[FAIL] 缺少样例文件：' + p);
        process.exit(1);
    }
    return fs.readFileSync(p, 'utf8');
}

const cases = ['01-single', '02-page', '03-mixed', '04-cheatsheet'];

console.log('\n[满文 → 拉丁]');
for (const c of cases) {
    cmp(c, R.manju2latin(read(path.join(SAMPLES, 'manju', c + '.txt'))),
           read(path.join(SAMPLES, 'latin', c + '.txt')));
}

console.log('\n[拉丁 → 满文]');
for (const c of cases) {
    cmp(c, R.latin2manju(read(path.join(SAMPLES, 'latin', c + '.txt'))),
           read(path.join(SAMPLES, 'reverse', c + '.manju.txt')));
}

// 重点形态：这些写法最容易在改规则时被破坏
console.log('\n[重点形态]');
const str = s => Array.from(s).map(c => c.codePointAt(0).toString(16)).join(' ');
console.log('  拉丁 "-i"  →', str(R.latin2manju('amba -i').trim()), '  (期望 1820 182e 182a 1820 202f 1873)');
console.log('  拉丁 "ci"  →', str(R.latin2manju('ci').trim()), '  (期望 186e 185f)');
console.log('  拉丁 "ng"  →', str(R.latin2manju('ng').trim()), '  (期望 1829)');

console.log(fail ? `\n共 ${fail} 处不一致` : '\n全部通过');
process.exit(fail ? 1 : 0);
