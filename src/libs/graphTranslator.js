/**
 * MathAcademy 知识图谱（Knowledge Graph）SVG 翻译模块。
 *
 * 背景：知识图谱是一张 graphviz 渲染的大 SVG，每个知识点是一个 <g class="node">，
 * 里面有：
 *   - <title>(1777) Triangular Matrices</title>   —— 完整未截断名（含数字ID前缀）
 *   - 一个或多个 <text>...</text>                  —— 折行后的显示文本（被切碎）
 *
 * 主翻译器 Translator 故意忽略 SVG（见 rules.js ignoreSelector / translator.js
 * REPLACE 集合），所以图谱里的英文一个都翻不到。本模块独立处理：
 *   从 <title> 取干净英文名 → apiTranslate（自带缓存）→ 写回 <text>。
 *
 * 完全独立，不碰 Translator 任何逻辑；关掉即恢复全英文，零副作用。
 */

import { apiTranslate } from "../apis";
import { DEFAULT_API_SETTING } from "../config";
import { logger } from "./log";
import { injectExternalJs } from "./injector";
import { browser } from "./browser";

// 已翻译标记，避免重复处理
const DONE_ATTR = "data-kiss-graph";
// <title> 里的数字ID前缀，如 "(1777) "
const ID_PREFIX_RE = /^\s*\(\d+\)\s*/;
// 图谱 SVG 选择器：MathAcademy 的图谱 SVG 自身无 id/class，
// 但包裹在 <div id="graph"> 里，用父容器定位最稳。
const GRAPH_SVG_SELECTOR = '#graph svg';
// 译文最小字号（缩放下限）
const MIN_FONT_SIZE = 14;
// 默认字号 / 行高（graphviz 图谱实测：字号20，行高24）
const DEFAULT_FONT_SIZE = 20;
const LINE_HEIGHT_RATIO = 1.2;
// 文字宽度安全系数：椭圆是曲线，文字按内接矩形排，留些余量
const WIDTH_SAFE = 0.9;
const HEIGHT_SAFE = 0.9;

// 复用一个 canvas 上下文测量文字宽度（比反复改 DOM 再 getComputedTextLength 快）
let _measureCtx = null;
function measureText(text, fontSize, fontFamily) {
  if (!_measureCtx) {
    const canvas = document.createElement("canvas");
    _measureCtx = canvas.getContext("2d");
  }
  _measureCtx.font = `${fontSize}px ${fontFamily || "Helvetica, sans-serif"}`;
  return _measureCtx.measureText(text).width;
}

/**
 * 把译文切成可断行的 token：连续的 ASCII（含数字/符号，如 "LU"、"2x2"）算一个不可拆
 * 整体，中文/日文等按单字拆（每字都可断行）。
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  const tokens = [];
  const re = /[A-Za-z0-9._+\-/×]+|\s+|[^\s]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}


/**
 * 椭圆方程算第 k 行布局里每一行的可用宽度。
 * 文字按内接矩形排，行 i 占据一条高 lh 的横带，取该带离中心最远那条边的椭圆半宽
 * （最窄处），保证整行都在椭圆内。x²/rx² + y²/ry² = 1 → halfW = rx·√(1-(y/ry)²)。
 * @returns {number[]} 长度为 k 的每行可用全宽
 */
function lineWidths(k, rx, ry, lh) {
  const widths = [];
  for (let i = 0; i < k; i++) {
    const dyCenter = (i - (k - 1) / 2) * lh; // 该行中心相对椭圆中心的 y
    const yEdge = Math.abs(dyCenter) + lh / 2; // 离中心最远的带边
    const ratio = yEdge / ry;
    const halfW = ratio >= 1 ? 0 : rx * Math.sqrt(1 - ratio * ratio);
    widths.push(2 * halfW * WIDTH_SAFE);
  }
  return widths;
}

/**
 * 按每行各自的可用宽度把 token 顺序填进 k 行。放得下返回行数组，放不下返回 null。
 */
function fillLines(tokens, widths, fontSize, ff) {
  const lines = [];
  let li = 0;
  let cur = "";
  let curW = 0;
  for (const tk of tokens) {
    if (li >= widths.length) return null;
    const w = measureText(tk, fontSize, ff);
    if (cur && curW + w > widths[li] && tk.trim()) {
      lines.push(cur);
      li++;
      if (li >= widths.length) return null;
      cur = tk.trim() ? tk : "";
      curW = cur ? w : 0;
    } else {
      cur += tk;
      curW += w;
    }
  }
  if (cur.trim()) lines.push(cur);
  // 单 token 已超出某行宽度的情况：宽度检查
  for (let i = 0; i < lines.length; i++) {
    if (measureText(lines[i], fontSize, ff) > widths[i]) return null;
  }
  return lines;
}

/**
 * 求解最佳布局：字号优先保持默认，放不下就分更多行，再不行才缩字号。
 * @returns {{fontSize: number, lines: string[]}}
 */
function solveLayout(text, rx, ry, ff) {
  const tokens = tokenize(text);
  for (let fs = DEFAULT_FONT_SIZE; fs >= MIN_FONT_SIZE; fs -= 1) {
    const lh = fs * LINE_HEIGHT_RATIO;
    const maxLines = Math.max(1, Math.floor((2 * ry * HEIGHT_SAFE) / lh));
    for (let k = 1; k <= maxLines; k++) {
      const widths = lineWidths(k, rx, ry, lh);
      if (widths.some((w) => w <= 0)) continue;
      const lines = fillLines(tokens, widths, fs, ff);
      if (lines && lines.length <= k) {
        return { fontSize: fs, lines };
      }
    }
  }
  // 兜底：最小字号、椭圆最中间单行（极少触发）
  return { fontSize: MIN_FONT_SIZE, lines: [text] };
}

/**
 * 当前页面是否 MathAcademy 知识图谱页
 * @returns {boolean}
 */
function isGraphPage() {
  try {
    const href = document?.location?.href || "";
    if (!/mathacademy\.com/i.test(href)) return false;
    return !!document.querySelector(GRAPH_SVG_SELECTOR);
  } catch (e) {
    return false;
  }
}

/**
 * 从节点 <g class="node"> 提取知识点英文名。
 *
 * 新版 MathAcademy 图谱：节点 <title> 只存纯数字 ID（如 "1777"），
 * 知识点名在前端 JS 状态 window._topics 里（{id, name, ...} 字典）。
 * 故：title 取数字 ID → 查 _topics[id].name 得英文名。
 * 老版（title 含 "(1777) Triangular Matrices"）仍兼容去前缀逻辑。
 *
 * @param {Element} nodeEl
 * @returns {string} 英文名，取不到返回 ""
 */
function getNodeName(nodeEl) {
  const titleEl = nodeEl.querySelector("title");
  const raw = (titleEl?.textContent || "").trim();
  if (!raw) return "";

  // 新版：纯数字 ID → 查主世界 window._topics（隔离世界读不到，需注入脚本取）
  if (/^\d+$/.test(raw)) {
    const topics = getTopicsMap();
    const name = topics?.[raw]; // injector-topics.js 写入精简映射 {id: "名字字符串"}
    if (name) return String(name).trim();
    return ""; // 有 ID 但查不到名字，跳过（不翻译数字）
  }

  // 老版兼容：(1777) Triangular Matrices → 去前缀
  return raw.replace(ID_PREFIX_RE, "").trim();
}

/**
 * 缓存一份 ID→name 映射。MathAcademy 把 _topics 挂在页面主世界 window 上，
 * content script 隔离世界读不到，内联脚本又被 CSP 拦截。故用扩展外部脚本
 * injector-topics.js（chrome-extension://，CSP 允许）注入主世界，由它把
 * _topics 序列化写进 <html data-ma-topics="...">，隔离世界再从 DOM 读回。
 */
let _topicsCache = null;
let _topicsInjecting = false;
function getTopicsMap() {
  if (_topicsCache) return _topicsCache;
  // 已写入 DOM 则读回
  const fromDom = document.documentElement.getAttribute("data-ma-topics");
  if (fromDom) {
    try {
      _topicsCache = JSON.parse(fromDom);
      return _topicsCache;
    } catch (e) {}
  }
  // 注入外部扩展脚本（CSP 允许 chrome-extension://，只注一次）
  if (!_topicsInjecting) {
    _topicsInjecting = true;
    try {
      const src = browser.runtime.getURL("injector-topics.js");
      injectExternalJs(src, "kiss-graph-topics-injector");
    } catch (e) {
      logger.debug("[GraphTranslator] 注入 injector-topics 失败:", e?.message);
    }
  }
  return null; // 本次返回 null，下次 DOM 写入后再读到
}


/**
 * 收集页面所有未翻译的图谱节点
 * @returns {Array<{el: Element, name: string, texts: Element[]}>}
 */
function collectNodes() {
  const result = [];
  document.querySelectorAll(`${GRAPH_SVG_SELECTOR} g.node`).forEach((el) => {
    if (el.getAttribute(DONE_ATTR)) return;
    const name = getNodeName(el);
    if (!name) return;
    const texts = Array.from(el.querySelectorAll("text"));
    if (!texts.length) return;
    result.push({ el, name, texts });
  });
  return result;
}

/**
 * 把译文写回节点的 <text> 元素。
 * 用椭圆几何把中文智能分行：字号优先 20，放不下先多分行（利用椭圆垂直空间），
 * 仍放不下才缩字号。每行宽度按椭圆方程在该行高度处的实际半宽约束，确保中文始终在椭圆内。
 * 复用已有 <text> 节点（不够则克隆，多余则清空），保留 graphviz 的字体/锚点属性。
 *
 * @param {{el: Element, name: string, texts: Element[]}} node
 * @param {string} trText 译文
 */
function applyTranslation(node, trText) {
  const { el, texts } = node;
  if (!trText || !texts.length) return;

  const ellipse = el.querySelector("ellipse");
  const cx = parseFloat(ellipse?.getAttribute("cx")) || parseFloat(texts[0].getAttribute("x")) || 0;
  const cy = parseFloat(ellipse?.getAttribute("cy")) || parseFloat(texts[0].getAttribute("y")) || 0;
  const rx = parseFloat(ellipse?.getAttribute("rx")) || 100;
  const ry = parseFloat(ellipse?.getAttribute("ry")) || 20;
  const ff = texts[0].getAttribute("font-family") || "Helvetica, sans-serif";

  const { fontSize, lines } = solveLayout(trText, rx, ry, ff);
  const lh = fontSize * LINE_HEIGHT_RATIO;

  // 用第一个 <text> 当模板克隆出足够的行节点
  const template = texts[0];
  const lineNodes = [];
  for (let i = 0; i < lines.length; i++) {
    let t = texts[i];
    if (!t) {
      t = template.cloneNode(false);
      template.parentNode.appendChild(t);
    }
    lineNodes.push(t);
  }
  // 多出来的旧节点清空文本（不删，省得动 DOM 结构）
  for (let i = lines.length; i < texts.length; i++) {
    texts[i].textContent = "";
  }

  // 各行垂直居中分布在椭圆里。SVG text 的 y 是 baseline，近似下移 fontSize*0.35。
  const baseY = cy - ((lines.length - 1) / 2) * lh + fontSize * 0.35;
  lineNodes.forEach((t, i) => {
    t.textContent = lines[i];
    t.setAttribute("x", `${cx}`);
    t.setAttribute("y", `${baseY + i * lh}`);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", `${fontSize}`);
  });

  el.setAttribute(DONE_ATTR, "1");
}

/**
 * 知识图谱翻译器。与 Translator 同级，由 TranslatorManager 挂载/销毁。
 */
export class GraphTranslator {
  #setting;
  #rule;
  #apiSetting;
  #toLang;
  #docObserver = null; // 监听整个文档，等图谱 SVG 出现 / 重渲染
  #started = false;
  #scanScheduled = false;

  constructor({ setting, rule }) {
    this.#setting = setting || {};
    this.#rule = rule || {};
    // 与 translator.js 同样的方式解析 apiSetting：按 apiSlug 在 transApis 里查
    const apis = this.#setting.transApis || [];
    this.#apiSetting =
      apis.find((a) => a.apiSlug === this.#rule.apiSlug) ||
      apis.find((a) => a.apiSlug === DEFAULT_API_SETTING.apiSlug) ||
      DEFAULT_API_SETTING;
    this.#toLang =
      this.#rule.toLang && this.#rule.toLang !== "*"
        ? this.#rule.toLang
        : "zh-CN";
  }

  start() {
    if (this.#started) return;
    // 只看域名，不看 SVG 是否已存在：图谱由 JS 动态渲染，启动时多半还没出现。
    const href = document?.location?.href || "";
    logger.debug("[GraphTranslator] start() called, href=", href);
    if (!/mathacademy\.com/i.test(href)) {
      logger.debug("[GraphTranslator] 非图谱域名，跳过");
      return;
    }
    this.#started = true;
    logger.debug("[GraphTranslator] started, waiting for graph");

    // 暴露全局手动触发：图谱需用户点按钮才加载，自动时序难以覆盖所有情况。
    // 用户点开图谱后，在控制台跑 __translateGraph() 即可强制翻译一次。
    if (typeof window !== "undefined") {
      window.__translateGraph = () => {
        if (!this.#started) this.#started = true;
        logger.debug("[GraphTranslator] 手动触发 scan");
        this.#scan();
      };
    }

    // 若图已存在，立即扫一次
    this.#scheduleScan();
    // 挂文档级观察器：图谱渲染出来 / 切换课程重渲染 / pan-zoom 重建时都会触发
    this.#observeDocument();
  }

  stop() {
    if (!this.#started) return;
    this.#started = false;
    this.#docObserver?.disconnect();
    this.#docObserver = null;
  }

  /**
   * 防抖调度一次扫描。多次触发只跑最后一次，避免 pan-zoom 频繁变动时狂扫。
   */
  #scheduleScan() {
    if (this.#scanScheduled) return;
    this.#scanScheduled = true;
    setTimeout(() => {
      this.#scanScheduled = false;
      if (this.#started && isGraphPage()) this.#scan();
    }, 500);
  }

  /**
   * 文档级观察器：监听 body 子树变化。图谱 SVG 出现或重渲染时调度扫描。
   * 只看 childList/subtree，不看 attributes，故 pan-zoom 的 transform 变动不会触发。
   */
  #observeDocument() {
    this.#docObserver = new MutationObserver((mutations) => {
      // 仅当有节点增删时才考虑重扫
      const hasStructuralChange = mutations.some(
        (m) => m.addedNodes.length || m.removedNodes.length
      );
      if (hasStructuralChange) this.#scheduleScan();
    });
    this.#docObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * 翻译单个名称，复用 apiTranslate 的缓存层。
   * @param {string} name
   * @returns {Promise<string>} 译文，失败返回 ""
   */
  async #translateName(name) {
    try {
      const { trText, isSame } = await apiTranslate({
        text: name,
        fromLang: "en",
        toLang: this.#toLang,
        apiSetting: this.#apiSetting,
      });
      if (isSame) return "";
      return trText || "";
    } catch (err) {
      logger.debug("[GraphTranslator] translate fail:", name, err?.message);
      return "";
    }
  }

  /**
   * 扫描并翻译当前所有未处理节点。相同名称只翻一次（去重 + 缓存）。
   */
  async #scan() {
    const nodes = collectNodes();
    const rawCount = document.querySelectorAll(`${GRAPH_SVG_SELECTOR} g.node`).length;
    const topics = getTopicsMap();
    logger.debug("[GraphTranslator] #scan: collectNodes=", nodes.length, "| DOM节点=", rawCount, "| topics映射=", topics ? Object.keys(topics).length : 0);
    if (!nodes.length) {
      // 节点存在但都没名字：_topics 主世界数据还没搬到 DOM，或还没加载。
      // 先尝试触发注入（getTopicsMap 已注入），再轮询读 DOM，最多 30 秒。
      const needTopics = rawCount > 0;
      logger.debug("[GraphTranslator] 节点空, needTopics=", needTopics);
      if (needTopics && this.#started) {
        let tries = 0;
        const wait = () => {
          if (!this.#started || tries > 30) return;
          tries++;
          // 清缓存强制重读 DOM（主世界注入后写入 data-ma-topics）
          _topicsCache = null;
          const t = getTopicsMap();
          logger.debug("[GraphTranslator] 轮询", tries, "topics=", t ? Object.keys(t).length : 0);
          if (t && Object.keys(t).length > 0) {
            this.#scan();
          } else {
            setTimeout(wait, 1000);
          }
        };
        setTimeout(wait, 1000);
      }
      return;
    }

    // 先按名称去重，避免重复请求
    const cache = new Map();
    await Promise.all(
      nodes.map(async (node) => {
        if (!this.#started) return;
        let trText = cache.get(node.name);
        if (trText === undefined) {
          trText = await this.#translateName(node.name);
          cache.set(node.name, trText);
        }
        if (this.#started) applyTranslation(node, trText);
      })
    );
  }
}


