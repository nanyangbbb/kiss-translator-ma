# MathAcademy 特化技术文档

本文面向开发者，介绍本仓库相对上游 KISS-Translator 的 8 个特化主题：每个主题按「问题 → 方案 → 关键代码定位」组织。行号以撰写时仓库状态为准，可能随提交漂移，以符号名为准。

## 1. MathAcademy DOM 适配与翻译范围限定

**问题**：MA 页面含大量不该翻译的内容——进度条、经验值环、排行榜、日期、纯数字文本，以及带交互行为的按钮；盲目翻译既浪费 API 用量，又可能破坏页面功能。

**方案**：三层过滤。第一层是正则黑名单（纯数字/日期直接跳过）；第二层按父级类名特征（`progress`、`xp-ring`、`leaderboard` 等）跳过 UI 组件；第三层是内置忽略选择器，把按钮类元素和 MA 专属 ID（如 `#dailyGoalProgressBar`）排除在扫描外。另有零成本本地微词典，把 `TODAY`、`LESSON` 等高频 UI 标签直接映射为中文，不消耗 API。已翻译的容器打上 `data-ma-translated` 属性防止重入。

**关键代码定位**（均在 `src/libs/translator.js`）：
- `BUILTIN_IGNORE_SELECTOR`（约 291 行）、`LOCAL_DICTIONARY`（约 301 行）、`BLACKLIST_TEXT_REGEX` / `BLACKLIST_DATE_REGEX` / `BLACKLIST_CLASS_PATTERNS`（约 311-317 行）
- 黑名单判定逻辑约 1474-1493 行；`data-ma-translated` 防重入检查约 1165 行、写入约 1552/1727 行

## 2. KaTeX/MathJax 公式全链路保护

**问题**：MA 的公式由 KaTeX/MathJax 渲染成复杂 DOM。若公式节点随正文一起送翻，模型会破坏 LaTeX 结构，页面公式即损坏。

**方案**：序列化阶段优先拦截公式节点——匹配 `MATH_SELECTOR`（覆盖 KaTeX、MathJax 2.x/3.x、通用 math 容器）的节点不进译文，而是替换为 `{N}` 占位符，原始 DOM 节点存入 `mathNodes` 映射。还原阶段不信任模型输出：译文渲染时查找带 `data-kiss-math` 标记的占位元素，用 `cloneNode(true)` 深克隆原始公式节点替换回去。公式从头到尾不经过模型，实现零损伤。

**关键代码定位**：
- `src/libs/translator.js`：`MATH_SELECTOR`（约 178 行）；`#serializeForTranslation` 生成 `placeholderMap`/`mathNodes`（约 1826-1971 行，调用点约 1521 行）；公式节点拦截约 1898 行；`#restoreFromTranslation`（约 1975 行起）；克隆还原约 1700-1710 行
- `src/libs/readAloud.js`：独立的 `MATH_SELECTOR` 副本（约 278 行），与主翻译器保持一致

## 3. 知识图谱 SVG 翻译

**问题**：MA 的知识图谱是 graphviz 渲染的大 SVG，主翻译器按规则忽略 SVG，图谱英文完全翻不到；且节点文字是在椭圆内折行显示的多个 `<text>` 切片，直接逐个翻译只会得到破碎的译文。

**方案**：独立模块 `GraphTranslator`，不碰主翻译器逻辑。从每个节点的 `<title>` 取完整未截断英文名（去掉 `(1777)` 数字 ID 前缀），经带缓存的 `apiTranslate` 翻译，再写回 `<text>`。写回时按椭圆方程计算每行可用宽度（`halfW = rx·√(1-(y/ry)²)`），用 canvas 上下文测量文字宽度后贪心分行，保证中文译文仍完整落在椭圆内。

```js
const halfW = ratio >= 1 ? 0 : rx * Math.sqrt(1 - ratio * ratio);
```

**关键代码定位**：
- `src/libs/graphTranslator.js`：`GRAPH_SVG_SELECTOR`（约 28 行，`#graph svg`）、`measureText`（约 40 行）、`tokenize`（约 55 行）、`lineWidths` 椭圆分行（约 72 行）
- `public/injector-topics.js`：主世界注入，读取页面 `window._topics` 写入 `<html data-ma-topics>` 供 content script 使用
- 接线：`src/libs/translatorManager.js`（约 88/115/175 行）

## 4. DeepSeek 数学翻译提示词与双逗号归一

**问题**：通用翻译提示词不懂数学教材语体，可能改写 LaTeX、丢格式标记；另外模型偶尔在占位符 `{N}` 两侧重复输出同一中文标点（如 `，{2}，`），还原后页面显示双逗号。

**方案**：DeepSeek 路径的系统提示词按三段拼接——占位符保护前缀（命令模型原样保留 `{N}`）+ 数学教学翻译提示词（信达雅标准、LaTeX/Markdown 原样保留、章节标题与常见句式对照）+ 基础翻译引擎提示词。双逗号在响应解析入口统一归一，正则要求占位符两侧是同一标点才去重，正常组合不受影响，且带快速路径预判避免逐条正则开销。

```js
const DUP_PUNCT_RE = /([，。；])\s*(\{\d+\})\s*\1/g;
```

**关键代码定位**：
- `src/config/deepseekPrompt.js`：`DEEPSEEK_MATH_PROMPT` 全文（约 5 行起）
- `src/libs/dupPunct.js`：`fixDupPunct` 与快速路径（约 10-19 行）
- `src/apis/trans.js`：三段式拼接约 957-963 行；`fixDupPunct` 调用约 195 行

## 5. 朗读：公式口语化 + speechSynthesis

**问题**：直接用 TTS 读数学内容，LaTeX 符号会被读成乱码或跳过；而把整段英文发给模型做口语化又有隐私与成本顾虑。

**方案**：两段式设计。先把已翻译段落拆分为英文模板 + 公式集合（公式以 `⟦Mn⟧` 占位），仅把公式 LaTeX 批量发给 DeepSeek，用专门的系统提示词转成教师授课式英文口语（矩阵按行列读、分式读 numerator over denominator 等），填回模板后交给浏览器 `speechSynthesis` 本地合成。英文正文从不外发，与 API 物理隔离。播放时按 `en-US natural/neural/google → en-US → 任意 en` 降级挑选音色，无后端依赖。

**关键代码定位**（均在 `src/libs/readAloud.js`）：
- `_DS_SYSTEM` 口语化提示词（约 23 行）；`fetchReadAloud`（约 65 行）；`#play` 与音色降级链（约 493-507 行）；`MATH_SELECTOR`（约 278 行）

## 6. 批量队列与性能

**问题**：MA 课程页一次加载上百个段落，逐段请求既慢又容易触发 API 限流；SPA 动态改写 DOM 时，若无节流会导致重复扫描与页面跳动。

**方案**：请求侧由 `BatchQueue` 聚合任务，按段落数与总字符数双阈值切批（`batchSize`/`batchLength`），配合 `TaskPool` 控制并发与最小启动间隔、区分终态错误（4xx 除 429 外不重试）；翻译结果进缓存，命中即不再请求。DOM 侧用 MutationObserver 把变更收敛到「脏容器」集合，`scheduleIdle`（requestIdleCallback 封装，100ms 超时兜底）统一重扫；所有改写 DOM 的操作包在视口锚定（记录并恢复滚动位置参照元素）中执行，避免翻译过程引起视口跳动。

**关键代码定位**：
- `src/libs/batchQueue.js`：`BatchQueue`（约 14 行起）；`src/libs/pool.js`：`TaskPool`；`src/libs/cache.js`：HTTP 缓存
- `src/libs/translator.js`：`#rescanQueue`（约 367 行）、`#queueForRescan` 防抖（约 1021-1031 行）、`#withViewportAnchor` 及配套方法（约 371-424 行）
- `src/libs/utils.js`：`scheduleIdle`（约 370 行）

## 7. 多端兼容

**问题**：同一套代码要跑在 Chrome 扩展、Tampermonkey、Android 浏览器内置脚本引擎、iOS Safari Userscripts 扩展上，各环境的 GM API 可用性与词法绑定行为不一致——部分 Android 引擎的 `GM` 是只读词法绑定，改 `window.GM` 影响不到代码里的裸 `GM` 引用。

**方案**：统一走 `window.KISS_GM` 通道。扩展环境下 `gm.js` 通过 CustomEvent ping/pong 把 GM 调用转发到有权限的上下文执行；构建期 `build-android.mjs` 在用户脚本头部注入 polyfill——存储退化到 `localStorage`、`GM_xmlhttpRequest` 用原生 fetch 实现，并注册 `KISS_GM` 作为主通道（fetch/storage 均优先读取它）。iOS 侧 `build-ios.mjs` 把 `@grant unsafeWindow` 替换为 `@inject-into content` 以适配 Userscripts 扩展；`mobile/math_academy_ipad.user.js` 则是完全独立的轻量版，内嵌同一份数学提示词与双逗号修复逻辑。

**关键代码定位**：
- `src/libs/gm.js`：`window.KISS_GM` 定义（约 50 行）；`src/libs/fetch.js`（约 27/92/200 行）与 `src/libs/storage.js`（约 28-49 行）的优先级读取
- `src/scripts/build-android.mjs`：GM polyfill 注入与 `KISS_GM` 注册（约 48-191 行）
- `src/scripts/build-ios.mjs`：`@inject-into` 替换；`mobile/math_academy_ipad.user.js`

## 8. 安全加固

**问题**：译文要写回 `innerHTML`，而 MA 页面启用了 CSP；模型输出若含恶意片段，经 innerHTML 即成 XSS 注入点；读取页面全局变量的内联脚本也会被 CSP 拦截。

**方案**：所有 HTML 写回统一经 `trustedTypesHelper`——页面支持 Trusted Types 时创建命名 policy，不支持时无条件先过 DOMPurify 消毒再返回，不存在「跳过消毒」的路径；脚本注入统一走该 helper 的 `createScript`/`createScriptURL`。读取 `window._topics` 的脚本以扩展外部资源（`chrome-extension://`）形式注入主世界——CSP 允许该来源，既绕开内联脚本限制，又不放宽页面安全策略。

**关键代码定位**：
- `src/libs/trustedTypes.js`：policy 创建与无条件消毒（约 4-40 行）
- 使用点：`src/libs/translator.js`（约 1682 行）、`src/libs/injector.js`（约 13/40 行）
- `public/injector-topics.js`：CSP 兼容的主世界注入
