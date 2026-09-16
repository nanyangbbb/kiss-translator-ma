/**
 * 英文朗读模块（PC 扩展 + iPad userscript 共用）
 *
 * 流程：
 *   已翻译段落 → 提取英文+LaTeX → {template, formulas}
 *   → DeepSeek 把公式 LaTeX 转英文口语（用户自己的 key，直连官方 API）
 *   → 浏览器 speechSynthesis 本地合成播放
 *
 * 设计要点：
 * - 英文正文从不发给 DeepSeek，仅公式发送（拆分-填回，物理隔离）
 * - 即使全中文模式原节点被移出 DOM，仍从内存原节点提取英文
 * - 无后端依赖：口语化走用户配置的 API，TTS 走系统本地语音
 */

import { getSetting } from "./storage";
import { fetchData } from "./fetch";

const DEFAULT_VOICE_LANG = "en-US";

/**
 * 公式口语化系统提示词（移植自服务端 read_service._DS_SYSTEM）。
 */
const _DS_SYSTEM =
  "You convert LaTeX math into natural spoken English, exactly as a teacher " +
  "would read it aloud in a lecture. Return ONLY a JSON object mapping each " +
  "given key to its spoken-English reading.\n\n" +
  "Rules:\n" +
  "- Matrices: describe dimensions, then read row by row " +
  '(e.g. "a 2 by 3 matrix: row 1, a, b, c; row 2, d, e, f.")\n' +
  '- Fractions: read as "numerator over denominator"\n' +
  '- Superscripts: read as "... to the power of ..." or "... squared/cubed"\n' +
  '- Subscripts: read as "... sub ..."\n' +
  "- Integrals/sums/limits: read naturally as in spoken math\n" +
  "- Greek letters: use their English names (alpha, beta, etc.)\n" +
  "- NEVER output LaTeX symbols or raw backslash commands\n" +
  "- Keep it concise and natural. No explanations.";

/**
 * 读取用户当前配置的 DeepSeek（或兼容 OpenAI 格式）API。
 * @returns {Promise<{url: string, key: string, model: string}|null>}
 */
async function getApiConfig() {
  try {
    const setting = await getSetting();
    const dsApi = setting?.transApis?.find(
      (a) => a.apiType === "DeepSeek" || a.apiSlug === "DeepSeek"
    );
    if (!dsApi?.key) return null;
    return {
      url: dsApi.url || "https://api.deepseek.com/chat/completions",
      key: dsApi.key,
      model: dsApi.model || "deepseek-chat",
    };
  } catch (e) {
    return null;
  }
}

/**
 * 合成朗读文本：公式批量转英文口语后填回模板。
 * @param {string} template 英文模板（公式用 ⟦Mn⟧ 占位）
 * @param {Object} formulas { M0: "latex", ... }
 * @returns {Promise<{text: string}>}
 */
export async function fetchReadAloud(template, formulas) {
  const cfg = await getApiConfig();
  if (!cfg) {
    throw new Error("请先在设置中配置 DeepSeek API Key 后使用朗读");
  }

  let text = template;
  const keys = Object.keys(formulas || {});
  if (keys.length) {
    const resp = await fetchData(
      cfg.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.key}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: _DS_SYSTEM },
            {
              role: "user",
              content:
                "Convert these LaTeX formulas to spoken English:\n" +
                JSON.stringify(formulas),
            },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      },
      { expect: "json" }
    );
    let spoken = {};
    try {
      spoken = JSON.parse(resp?.choices?.[0]?.message?.content || "{}");
    } catch (e) {}
    // 缺失的 key 用原始 latex 兜底
    const resolved = {};
    for (const k of keys) {
      resolved[k] =
        (typeof spoken[k] === "string" && spoken[k]) || formulas[k];
    }
    text = template.replace(/⟦(M\d+)⟧/g, (_, k) => resolved[k] || "");
  }
  return { text };
}

// ============ 公式 LaTeX 源提取 ============

/**
 * 从一个数学公式元素里提取 LaTeX 源码。
 * 按可靠性分层回退：
 *  1. KaTeX：annotation[encoding="application/x-tex"]
 *  2. MathJax v2：script[type="math/tex"]
 *  3. 元素自带的 data 属性（部分站点保留原始 TeX）
 *  4. MathML <annotation> 任意编码
 *  5. MathML 结构重建（<mtable>/<mfrac>/<msqrt> 等 → LaTeX）
 *  6. 最后兜底：可见文本（去掉多余空白）
 * @param {Element} el
 * @returns {string}
 */
function extractLatex(el) {
  if (!el) return "";

  // 1. KaTeX 标准：MathML 语义里的 x-tex 注解
  const tex = el.querySelector?.('annotation[encoding="application/x-tex"]');
  if (tex?.textContent) return tex.textContent.trim();

  // 2. MathJax v2：相邻或内部的 math/tex script
  const mjScript =
    el.querySelector?.('script[type^="math/tex"]') ||
    (el.tagName === "SCRIPT" && /^math\/tex/.test(el.type) ? el : null);
  if (mjScript?.textContent) return mjScript.textContent.trim();

  // 3. data 属性（KaTeX auto-render / 部分自定义渲染保留）
  const dataTex =
    el.getAttribute?.("data-latex") ||
    el.getAttribute?.("data-tex") ||
    el.getAttribute?.("data-original");
  if (dataTex) return dataTex.trim();

  // 4. 任意 MathML annotation
  const anyAnno = el.querySelector?.("annotation");
  if (anyAnno?.textContent) return anyAnno.textContent.trim();

  // 5. MathML 结构 → LaTeX 重建（处理 annotation 缺失但有 MathML 的情况）
  const mathEl = el.tagName === "MATH" ? el : el.querySelector?.("math");
  if (mathEl) {
    const rebuilt = _mathmlToLatex(mathEl);
    if (rebuilt) return rebuilt;
  }

  // 6. 兜底：可见文本（KaTeX/MathJax 的视觉文本，不理想但聊胜于无）
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * 将 MathML 子树转回 LaTeX 源码（有限支持常见结构）。
 * 仅处理：<mn> <mi> <mo> <mtext> <mrow> <mfrac> <msqrt> <msup> <msub>
 *        <msubsup> <munderover> <mtable>/<mtr>/<mtd> <mfenced>
 * @param {Element} el MathML 元素
 * @returns {string|null}
 */
function _mathmlToLatex(el) {
  if (!el) return null;
  const tag = el.tagName?.toLowerCase();
  const children = Array.from(el.children || []);

  // 纯文本 token
  if (tag === "mn") return el.textContent?.trim() || "";
  if (tag === "mi") {
    const t = (el.textContent || "").trim();
    // 多字符 mi 可能是函数名，加 \text
    if (t.length > 1) return `\\text{${t}}`;
    return t;
  }
  if (tag === "mo") {
    const t = (el.textContent || "").trim();
    // 常见运算符映射
    const opMap = {
      "(": "(", ")": ")", "[": "[", "]": "]",
      "+": "+", "-": "-", "=": "=", "<": "<", ">": ">",
      "×": "\\times", "⋅": "\\cdot", "±": "\\pm",
      "…": "\\dots", "⋯": "\\cdots",
    };
    return opMap[t] || t;
  }
  if (tag === "mtext") return el.textContent?.trim() || "";

  // 容器
  if (tag === "mrow" || tag === "math" || tag === "semantics" || tag === "mstyle") {
    const parts = children.map(_mathmlToLatex).filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  }

  // 分数
  if (tag === "mfrac") {
    const num = _mathmlToLatex(children[0]);
    const den = _mathmlToLatex(children[1]);
    if (num && den) return `\\frac{${num}}{${den}}`;
    return null;
  }

  // 平方根
  if (tag === "msqrt") {
    const inner = children.map(_mathmlToLatex).filter(Boolean).join(" ");
    return inner ? `\\sqrt{${inner}}` : null;
  }

  // 上下标
  if (tag === "msup") {
    const base = _mathmlToLatex(children[0]);
    const exp = _mathmlToLatex(children[1]);
    if (base && exp) return `${base}^{${exp}}`;
  }
  if (tag === "msub") {
    const base = _mathmlToLatex(children[0]);
    const sub = _mathmlToLatex(children[1]);
    if (base && sub) return `${base}_{${sub}}`;
  }
  if (tag === "msubsup") {
    const base = _mathmlToLatex(children[0]);
    const sub = _mathmlToLatex(children[1]);
    const sup = _mathmlToLatex(children[2]);
    if (base && sub && sup) return `${base}_{${sub}}^{${sup}}`;
  }

  // 求和/积分 上下限（简化）
  if (tag === "munderover" || tag === "munder" || tag === "mover") {
    const op = _mathmlToLatex(children[0]) || "";
    const under = children[1] ? _mathmlToLatex(children[1]) : "";
    const over = children[2] ? _mathmlToLatex(children[2]) : "";
    let result = op;
    if (under) result += `_{${under}}`;
    if (over) result += `^{${over}}`;
    return result;
  }

  // 括号
  if (tag === "mfenced") {
    const open = el.getAttribute("open") || "(";
    const close = el.getAttribute("close") || ")";
    const inner = children.map(_mathmlToLatex).filter(Boolean).join(", ");
    return `${open}${inner}${close}`;
  }

  // 矩阵
  if (tag === "mtable") {
    const rows = children
      .filter((c) => c.tagName?.toLowerCase() === "mtr")
      .map((mtr) =>
        Array.from(mtr.children || [])
          .filter((c) => c.tagName?.toLowerCase() === "mtd")
          .map((mtd) => _mathmlToLatex(mtd) || "{}")
          .join(" & ")
      );
    if (rows.length === 0) return null;
    // 用无括号 matrix 环境，外围 <mo> 提供括号
    return `\\begin{matrix} ${rows.join(" \\\\ ")} \\end{matrix}`;
  }

  // 表格行/单元格（由 mtable 递归调用）
  if (tag === "mtr" || tag === "mtd") {
    const parts = children.map(_mathmlToLatex).filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  }

  return null;
}

// 数学公式容器选择器（与 translator.js 的 MATH_SELECTOR 保持一致）
const MATH_SELECTOR =
  ".katex, .katex-display, .MathJax, .MathJax_Display, .MathJax_Preview, .MathJax_CHTML, .MathJax_SVG, .mjpage, mjx-container, mjx-math, [class*='mathjax' i], [class*='MathJax'], .math-inline, .math-display, math, .math";

/**
 * 把一组段落原节点拆成 {template, formulas}。
 * - 遇到公式容器：替换为 ⟦Mn⟧ 占位符，LaTeX 存入 formulas
 * - 文本节点：原样拼接
 * - 文本中的 $...$ / $$...$$：本身就是 LaTeX，也抽成占位符
 * @param {Node|Node[]} roots 已翻译段落的原始节点（一个或一组）
 * @returns {{template: string, formulas: Object, plainLen: number}}
 */
export function buildTemplate(roots) {
  const rootNodes = Array.isArray(roots) ? roots : [roots];
  const formulas = {};
  let counter = 0;
  let template = "";
  let plainLen = 0; // 非公式英文字符数，用于判断是否值得朗读

  const addFormula = (latex) => {
    const key = `M${counter++}`;
    formulas[key] = latex;
    return ` ⟦${key}⟧ `;
  };

  const walk = (node) => {
    if (!node) return;

    // 元素节点
    if (node.nodeType === Node.ELEMENT_NODE) {
      // 跳过已插入的译文节点和不可读元素
      const tag = node.tagName;
      if (
        tag === "SCRIPT" ||
        tag === "STYLE" ||
        tag === "MA-TRANS" ||
        node.classList?.contains?.("notranslate")
      ) {
        return;
      }
      // 公式容器：整体替换为占位符
      if (node.matches?.(MATH_SELECTOR)) {
        const latex = extractLatex(node);
        if (latex) template += addFormula(latex);
        return;
      }
      // 普通元素：递归子节点
      node.childNodes.forEach(walk);
      return;
    }

    // 文本节点
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent || "";
      // 抽取文本里的 $$...$$ 和 $...$（本身即 LaTeX）
      text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) =>
        addFormula(inner.trim())
      );
      text = text.replace(/\$(?![\d\s])([^$\n]+?)\$(?![\d\s])/g, (_, inner) =>
        addFormula(inner.trim())
      );
      plainLen += text.replace(/⟦M\d+⟧/g, "").trim().length;
      template += text;
    }
  };

  rootNodes.forEach(walk);
  template = template.replace(/\s+/g, " ").trim();
  return { template, formulas, plainLen };
}

// ============ 朗读管理器 ============

const BTN_CLASS = "ma-read-btn";
const BTN_MARK = "data-ma-read-bound";

/**
 * 朗读管理器：开关、按钮注入、播放、预取。
 * 由 translatorManager 持有一个实例。
 * @param {Function} getUnits 返回 [{wrapper, origin}] 的函数，origin 是英文原节点
 */
export class ReadAloudManager {
  #enabled = false;
  #getUnits;
  #audio = null; // 当前播放的 SpeechSynthesisUtterance
  #cache = new Map(); // origin 节点 -> {text} 预取缓存
  #io = null; // IntersectionObserver 预取
  #mo = null; // MutationObserver 监听新译文出现
  #refreshTimer = null;

  constructor(getUnits) {
    this.#getUnits = getUnits;
  }

  get enabled() {
    return this.#enabled;
  }

  toggle() {
    if (this.#enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.#enabled;
  }

  enable() {
    if (this.#enabled) return;
    this.#enabled = true;
    this.#setupObserver();
    this.#setupMutationObserver();
    this.refresh();
  }

  disable() {
    if (!this.#enabled) return;
    this.#enabled = false;
    this.#stopAudio();
    this.#io?.disconnect();
    this.#io = null;
    this.#mo?.disconnect();
    this.#mo = null;
    this.#cache.clear();
    // 移除所有按钮
    document
      .querySelectorAll(`.${BTN_CLASS}`)
      .forEach((b) => b.remove());
    document
      .querySelectorAll(`[${BTN_MARK}]`)
      .forEach((el) => el.removeAttribute(BTN_MARK));
  }

  /**
   * 给所有已翻译段落补上 🔊 按钮（防抖，可重复调用）。
   * 由 translatorManager 在翻译完成/DOM 变化后触发。
   */
  refresh() {
    if (!this.#enabled) return;
    clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => this.#doRefresh(), 150);
  }

  #doRefresh() {
    if (!this.#enabled) return;
    const units = this.#getUnits?.() || [];
    for (const { wrapper, origin } of units) {
      if (!wrapper?.isConnected || !origin) continue;
      if (wrapper.hasAttribute(BTN_MARK)) continue;
      wrapper.setAttribute(BTN_MARK, "1");
      const btn = this.#createButton(origin);
      wrapper.appendChild(btn);
      // 注册预取观察
      this.#io?.observe(wrapper);
    }
  }

  #createButton(origin) {
    const btn = document.createElement("button");
    btn.className = BTN_CLASS;
    btn.type = "button";
    btn.title = "朗读英文原文";
    btn.textContent = "🔊";
    btn.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;" +
      "margin-left:6px;padding:0 4px;border:none;background:transparent;" +
      "cursor:pointer;font-size:0.95em;line-height:1;opacity:0.65;" +
      "vertical-align:middle;border-radius:4px;transition:opacity .15s;";
    btn.addEventListener("mouseenter", () => (btn.style.opacity = "1"));
    btn.addEventListener("mouseleave", () => (btn.style.opacity = "0.65"));
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.#handleClick(origin, btn);
    });
    return btn;
  }

  async #handleClick(origin, btn) {
    const cached = this.#cache.get(origin);
    if (cached?.text) {
      this.#play(cached.text, btn);
      return;
    }
    if (btn.dataset.loading === "1") return;
    btn.dataset.loading = "1";
    const prev = "🔊";
    btn.textContent = "⏳";
    try {
      const data = await this.#synthForOrigin(origin);
      if (data?.text) {
        this.#play(data.text, btn);
      } else {
        btn.textContent = "⚠️";
        setTimeout(() => (btn.textContent = prev), 1500);
      }
    } catch (e) {
      btn.title = e?.message || "朗读失败";
      btn.textContent = "⚠️";
      setTimeout(() => (btn.textContent = prev), 1500);
    } finally {
      btn.dataset.loading = "0";
    }
  }

  async #synthForOrigin(origin) {
    if (this.#cache.has(origin)) return this.#cache.get(origin);
    const { template, formulas, plainLen } = buildTemplate(origin);
    if (!template || (plainLen === 0 && Object.keys(formulas).length === 0)) {
      return null;
    }
    const data = await fetchReadAloud(template, formulas);
    this.#cache.set(origin, data);
    return data;
  }

  #play(text, btn) {
    this.#stopAudio();
    if (!("speechSynthesis" in window)) {
      btn.textContent = "⚠️";
      setTimeout(() => (btn.textContent = "🔊"), 1500);
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = DEFAULT_VOICE_LANG;
    const voices = speechSynthesis.getVoices();
    const voice =
      voices.find((v) => /en[-_]US/i.test(v.lang) && /natural|neural|google/i.test(v.name)) ||
      voices.find((v) => /en[-_]US/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang));
    if (voice) utter.voice = voice;
    utter.rate = 1.0;
    btn.textContent = "⏸";
    utter.onend = () => {
      btn.textContent = "🔊";
    };
    utter.onerror = () => {
      btn.textContent = "⚠️";
      setTimeout(() => (btn.textContent = "🔊"), 1500);
    };
    this.#audio = utter;
    speechSynthesis.speak(utter);
  }

  #stopAudio() {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
    this.#audio = null;
  }

  #setupObserver() {
    if (this.#io || !("IntersectionObserver" in window)) return;
    this.#io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const wrapper = entry.target;
          this.#io.unobserve(wrapper);
          const unit = (this.#getUnits?.() || []).find(
            (u) => u.wrapper === wrapper
          );
          if (unit?.origin && !this.#cache.has(unit.origin)) {
            this.#synthForOrigin(unit.origin).catch(() => {});
          }
        }
      },
      { rootMargin: "200px 0px" }
    );
  }

  /** 监听新译文 wrapper 出现，自动补按钮（不侵入翻译流程） */
  #setupMutationObserver() {
    if (this.#mo || !("MutationObserver" in window)) return;
    this.#mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          this.refresh();
          return;
        }
      }
    });
    this.#mo.observe(document.body, { childList: true, subtree: true });
  }
}
