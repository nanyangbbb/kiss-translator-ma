# KISS Translator MA

基于开源项目 [KISS-Translator](https://github.com/fishjar/kiss-translator)（GPL-3.0）的 MathAcademy 特化版：
为 [MathAcademy](https://www.mathacademy.com) 数学学习平台提供高质量中文双语翻译，
LaTeX/KaTeX 公式零损伤，自带知识图谱翻译、英文朗读（公式口语化）等特化。

> 本项目为个人学习用途的非官方第三方工具，与 MathAcademy 无任何关联。

## 特性（相对原版的特化）

- 公式保护：占位符 + DOM 克隆还原，LaTeX 零损伤
- 数学翻译提示词：信达雅标准，公式/格式原样保留
- 双逗号归一：占位符两侧重复中文标点自动去重
- 知识图谱翻译：SVG 节点椭圆几何分行排版
- MA 站点适配：DOM 黑名单 / 本地词典 / 动态重扫防抖 / 视口锚定
- 批量翻译队列 + 缓存
- 英文朗读：公式转教师口语（DeepSeek）+ 浏览器本地 TTS（speechSynthesis）
- 多端：Chrome/Edge 扩展、Tampermonkey 用户脚本、iOS Safari 用户脚本

特化实现思路详见 [docs/mathacademy-specializations.md](docs/mathacademy-specializations.md)。

## 快速开始

### 1. 安装

- **浏览器扩展**：从 Release 下载解压，或自行构建（见下），将 `build/chrome` 目录以「加载已解压的扩展程序」载入（Chrome/Edge 均可）
- **Tampermonkey**：安装构建产物 `build/web/kiss-translator.user.js`（Release 亦提供）
- **iOS Safari**（[Userscripts](https://github.com/quoid/userscripts) 扩展）：安装 `mobile/math_academy_ipad.user.js`（轻量独立版，专为移动端优化）

扩展仅在 `mathacademy.com` 域下生效（见 `public/manifest.json` 的 matches），其他站点不受影响。

### 2. 配置 API Key（必做）

1. 到 [platform.deepseek.com](https://platform.deepseek.com) 注册并创建 API Key
2. 打开扩展设置 → 翻译服务 → DeepSeek，粘贴 Key（默认引擎即 DeepSeek，模型 `deepseek-chat`，直连官方接口）
3. 打开 MathAcademy 课程页，翻译自动生效

> 也支持任意 OpenAI 兼容 API（设置里选自定义接口）。朗读的公式口语化需要 DeepSeek Key；TTS 本身走系统语音，不走 API。

## 构建

需要 Node.js 与 [pnpm](https://pnpm.io)。`pnpm install` 后：

```bash
pnpm build:chrome         # Chrome 扩展 → build/chrome
pnpm build:web            # Web 版 + Tampermonkey 用户脚本 → build/web/kiss-translator.user.js
pnpm build:userscript-ios # iOS Safari 适配版（@grant unsafeWindow → @inject-into content）
pnpm build+zip            # 全目标构建并打包
```

另支持 `build:edge` / `build:firefox` / `build:thunderbird` / `build:safari-output`，完整列表见 `package.json`。

- Android 浏览器用户脚本：先 `pnpm build:web`，再 `pnpm zx src/scripts/build-android.mjs`（自动注入 GM polyfill）。
- `build+zip` 带 `CI=true` 前缀：使 react-scripts 以 CI 模式运行 ESLint 严格检查（警告视为错误），避免本地构建漏过 lint 问题。

## 目录结构

- `src/` — 扩展与用户脚本源码（CRA + react-app-rewired），`src/libs` 为核心逻辑
- `public/` — manifest、图标、主世界注入脚本（`injector-*.js`）
- `mobile/` — iPad 轻量独立用户脚本
- `docs/` — 技术文档

## 致谢

- [KISS-Translator](https://github.com/fishjar/kiss-translator) by Gabe — 本项目基于其 v2.0.21 fork

## 许可证

[GPL-3.0](LICENSE)
