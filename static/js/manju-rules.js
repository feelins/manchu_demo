/* ============================================================
   满文 ⇄ 拉丁转写 · 规则表（全站单一权威来源）

   被两个模块共用：
     /translit/   传统满文 ⇄ 拉丁满文（双向）
     /translate/  满汉翻译页的中间栏（拉丁 → 传统满文实时预览）

   规则表最初定义在 translit.js 中；2026-09-24 移植翻译模块时抽出，
   避免两份拷贝各自演化。**修改规则只改本文件**，两个模块同步生效。
   依赖：无。请在模块的业务 JS 之前引入。
   ============================================================ */
(function () {
    function u(code) { return String.fromCharCode(code); }

    // 传统满文 Unicode → 拉丁转写
    const MANJU_TO_LATIN_RULES = [
        {from: u(0x1829), to: "ng"}, {from: u(0x183A), to: "k'"}, {from: u(0x186C), to: "g'"},
        {from: u(0x202F)+u(0x1873), to: "-i"}, {from: u(0x186D), to: "h'"},
        {from: u(0x186E)+u(0x185F), to: "ci"}, {from: u(0x186E), to: "c"},
        {from: u(0x186F), to: "z"}, {from: u(0x1870), to: "r'"},
        {from: u(0x1830)+u(0x185F), to: "si'"}, {from: u(0x1871)+u(0x1873), to: "q'i"},
        {from: u(0x1877)+u(0x1873), to: "j'i"}, {from: u(0x1820), to: "a"},
        {from: u(0x182A), to: "b"}, {from: u(0x1834), to: "q"}, {from: u(0x1869), to: "d"},
        {from: u(0x185D), to: "e"}, {from: u(0x1876), to: "f"}, {from: u(0x1864), to: "g"},
        {from: u(0x1865), to: "h"}, {from: u(0x1873), to: "i"}, {from: u(0x1835), to: "j"},
        {from: u(0x1874), to: "k"}, {from: u(0x182F), to: "l"}, {from: u(0x182E), to: "m"},
        {from: u(0x1828), to: "n"}, {from: u(0x1823), to: "o"}, {from: u(0x1866), to: "p"},
        {from: u(0x1875), to: "r"}, {from: u(0x1830), to: "s"}, {from: u(0x1868), to: "t"},
        {from: u(0x1860), to: "u"}, {from: u(0x1861), to: "v"}, {from: u(0x1838), to: "w"},
        {from: u(0x1867), to: "x"}, {from: u(0x1836), to: "y"},
        {from: "ao", to: "au"}, {from: "eo", to: "eu"}, {from: "io", to: "iu"},
        {from: "oo", to: "ou"}, {from: "uo", to: "uu"}, {from: "vo", to: "vu"},
        {from: u(0x1808), to: ","}, {from: u(0x1809), to: "."}
    ];

    // 拉丁转写 → 传统满文 Unicode
    const LATIN_TO_MANJU_RULES = [
        {from: "ng", to: u(0x1829)}, {from: "-i", to: u(0x202F)+u(0x1873)},
        {from: "k'", to: u(0x183A)}, {from: "g'", to: u(0x186C)}, {from: "h'", to: u(0x186D)},
        {from: "ci", to: u(0x186E)+u(0x185F)}, {from: "c'i", to: u(0x186E)+u(0x185F)},
        {from: "c'", to: u(0x186E)}, {from: "z", to: u(0x186F)}, {from: "r'", to: u(0x1870)},
        {from: "n'", to: u(0x1828)+u(0x180B)}, {from: u(0x17E), to: u(0x1870)},
        {from: "sy", to: u(0x1830)+u(0x185F)}, {from: "si'", to: u(0x1830)+u(0x185F)},
        {from: "q'i", to: u(0x1871)+u(0x1873)}, {from: "q'y", to: u(0x1871)+u(0x1873)},
        {from: "qy", to: u(0x1871)+u(0x1873)}, {from: "j'i", to: u(0x1877)+u(0x1873)},
        {from: "jy'", to: u(0x1877)+u(0x1873)}, {from: "jy", to: u(0x1877)+u(0x1873)},
        {from: "au", to: "ao"}, {from: "eu", to: "eo"}, {from: "iu", to: "io"},
        {from: "ou", to: "oo"}, {from: "uu", to: "uo"}, {from: "vu", to: "vo"},
        {from: " i ", to: " "+u(0x200D)+u(0x1873)+" "},
        {from: "a", to: u(0x1820)}, {from: "b", to: u(0x182A)}, {from: "q", to: u(0x1834)},
        {from: "d", to: u(0x1869)}, {from: "e", to: u(0x185D)}, {from: "f", to: u(0x1876)},
        {from: "g", to: u(0x1864)}, {from: "h", to: u(0x1865)}, {from: "i", to: u(0x1873)},
        {from: "j", to: u(0x1835)}, {from: "k", to: u(0x1874)}, {from: "l", to: u(0x182F)},
        {from: "m", to: u(0x182E)}, {from: "n", to: u(0x1828)}, {from: "o", to: u(0x1823)},
        {from: "p", to: u(0x1866)}, {from: "r", to: u(0x1875)}, {from: "s", to: u(0x1830)},
        {from: "t", to: u(0x1868)}, {from: "u", to: u(0x1860)}, {from: "v", to: u(0x1861)},
        {from: u(0x16B), to: u(0x1861)}, {from: "w", to: u(0x1838)}, {from: "x", to: u(0x1867)},
        {from: u(0x161), to: u(0x1867)}, {from: "y", to: u(0x1836)},
        {from: ",", to: u(0x1808)}, {from: ".", to: u(0x1809)}
    ];

    /** 按 rules 顺序做全局替换（引擎：顺序敏感，靠前规则先匹配） */
    function applyRules(text, rules) {
        let result = text;
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            const escaped = rule.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'g');
            result = result.replace(regex, rule.to);
        }
        return result;
    }

    window.ManjuRules = {
        u: u,
        MANJU_TO_LATIN_RULES: MANJU_TO_LATIN_RULES,
        LATIN_TO_MANJU_RULES: LATIN_TO_MANJU_RULES,
        applyRules: applyRules,
        // 便捷函数
        manju2latin: function (text) { return applyRules(text, MANJU_TO_LATIN_RULES); },
        latin2manju: function (text) { return applyRules(text, LATIN_TO_MANJU_RULES); },
    };

    // 兼容 translit.js 原有的直接引用写法
    window.MANJU_TO_LATIN_RULES = MANJU_TO_LATIN_RULES;
    window.LATIN_TO_MANJU_RULES = LATIN_TO_MANJU_RULES;
    window.applyRules = applyRules;
})();
