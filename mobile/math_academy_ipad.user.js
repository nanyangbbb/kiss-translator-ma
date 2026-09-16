// ==UserScript==
// @name         MathAcademy 翻译辅助 (移动端版)
// @namespace    http://tampermonkey.net/
// @version      2.1.4
// @description  为 MathAcademy 提供中英文翻译，专为 iPad / 移动端优化
// @author       MathAcademy
// @match        *://*.mathacademy.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.deepseek.com
// @updateURL    https://raw.githubusercontent.com/nanyangbbb/kiss-translator-ma/main/dist/math_academy_ipad.user.js
// @downloadURL  https://raw.githubusercontent.com/nanyangbbb/kiss-translator-ma/main/dist/math_academy_ipad.user.js
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // HTTP transport — detects Tampermonkey / Stay / native fetch
  // ============================================================
  var DS_API = "https://api.deepseek.com/chat/completions";
  var DS_MODEL = "deepseek-chat";
  // 数学教程翻译系统提示词（与桌面版 src/config/deepseekPrompt.js 保持一致）
  var MA_TRANSLATE_PROMPT = "你是一位专业的数学教程翻译专家，负责将 MathAcademy 平台的网页内容从英文翻译成中文。\n\n## 翻译标准：信达雅\n- 信：准确传达原文数学概念和逻辑\n- 达：语句通顺，符合中文表达习惯\n- 雅：用词得体，适合中小学生阅读\n\n## 原样保留（绝不翻译）\n- LaTeX 命令和环境（\\section*、\\textbf、\\begin{itemize} 等）\n- 数学公式（$...$ 和 \\[...\\] 内的所有内容，以及 $x^2$、$$\\frac{a}{b}$$、\\begin{aligned}...\\end{aligned} 等）\n- Markdown 格式标记（如 **粗体**、*斜体*、`代码`、```代码块```、列表、标题等）\n- 向量符号 ⟨⟩、下标符号（如 b₁ b₂ b₃）等数学排版符号\n- 人名保留英文（Nancy → Nancy，Tom → Tom）\n\n## 章节标题对照\n- Introduction → 引入\n- Example: ... → 例题：...\n- Explanation → 解析\n- Word Problem(s) → 应用题\n- Watch Out! → 注意！\n- Review → 复习\n- Summary → 总结\n\n## 常见表达对照\n- Let's find the value of... → 我们来求...的值\n- As an example, ... → 举个例子，...\n- First, we... → 首先，...\n- Next, we... → 接下来，...\n- Then, we... → 然后，...\n- Finally, we... → 最后，...\n- Therefore, ... → 因此，...\n- So, ... → 所以，...\n- Thus, ... → 于是，...\n- To illustrate, ... → 为了说明，...\n- What is...? → ...等于多少？\n- Find the value of... → 求...的值\n- Note that... → 注意...\n- In other words, ... → 换句话说，...\n- Recall that... → 回顾一下，...\n- In general, ... → 一般来说，...\n\n## 翻译原则\n1. 通读全文，保持上下文理解，确保前后术语一致\n2. 文本与公式的衔接要自然流畅，避免生硬的直译\n3. 用词简洁明了，适合中小学生理解\n4. 只翻译自然语言部分，不要修改任何格式符号和数学表达式\n\n## 输出要求\n直接输出翻译后的完整内容，不要加任何额外说明或代码块包裹。";
  // 双逗号修复：占位符 {N} 两侧同一中文标点去重（与桌面版 src/libs/dupPunct.js 一致）
  var DUP_PUNCT_RE = /([，。；])\s*(\{\d+\})\s*\1/g;
  function fixDupPunct(s) {
    if (typeof s !== "string" || !/[，。；]\s*\{/.test(s)) return s;
    return s.replace(DUP_PUNCT_RE, "$1$2");
  }

  function httpPost(url, body, headers) {
    var payload = JSON.stringify(body);

    // 1) GM_xmlhttpRequest (underscore, callback) — Stay & Tampermonkey both grant this.
    //    This is the path that actually runs on iPad/Stay; bypasses mixed-content.
    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise(function (resolve, reject) {
        GM_xmlhttpRequest({
          method: "POST",
          url: url,
          headers: headers,
          data: payload,
          timeout: 30000,
          onload: function (r) { resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, _text: r.responseText }); },
          onerror: function (e) { reject(new Error("Network error" + (e && e.error ? ": " + e.error : ""))); },
          ontimeout: function () { reject(new Error("Timeout")); },
        });
      });
    }

    // 2) GM.xmlHttpRequest (dot, promise-ish) — newer Tampermonkey grant style.
    if (typeof GM !== "undefined" && GM.xmlHttpRequest) {
      return new Promise(function (resolve, reject) {
        GM.xmlHttpRequest({
          method: "POST",
          url: url,
          headers: headers,
          data: payload,
          timeout: 30000,
          onload: function (r) { resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, _text: r.responseText }); },
          onerror: function () { reject(new Error("Network error")); },
          ontimeout: function () { reject(new Error("Timeout")); },
        });
      });
    }

    // 3) Fallback: native fetch (works HTTP→HTTP, blocked by mixed-content on HTTPS pages).
    return fetch(url, { method: "POST", headers: headers, body: payload })
      .then(function (r) {
        return r.text().then(function (t) { return { ok: r.ok, status: r.status, _text: t }; });
      });
  }

  // ============================================================
  // Storage helpers
  // ============================================================
  var STORAGE_KEY = "math_activation_code";

  function getCode() {
    try { return localStorage.getItem(STORAGE_KEY) || ""; }
    catch (e) { return ""; }
  }

  function setCode(c) {
    try { localStorage.setItem(STORAGE_KEY, c.trim()); }
    catch (e) {}
  }

  function clearCode() {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch (e) {}
  }

  // ============================================================
  // Display mode — "zh" 全中文替换(默认, 与 PC 一致) / "bi" 双语对照
  // 切换仅改 <html> class，由 CSS 控制显隐，无需重新翻译
  // ============================================================
  var MODE_KEY = "math_display_mode";

  function getMode() {
    try { return localStorage.getItem(MODE_KEY) === "bi" ? "bi" : "zh"; }
    catch (e) { return "zh"; }
  }

  function applyMode(mode) {
    var html = document.documentElement;
    html.classList.remove("ma-mode-zh", "ma-mode-bi");
    html.classList.add(mode === "bi" ? "ma-mode-bi" : "ma-mode-zh");
  }

  function setMode(mode) {
    mode = mode === "bi" ? "bi" : "zh";
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
    applyMode(mode);
  }

  // 划词翻译开关 (默认开, 与 PC 一致)
  var SEL_KEY = "math_selection_on";

  function getSelOn() {
    try { return localStorage.getItem(SEL_KEY) !== "false"; }
    catch (e) { return true; }
  }

  function setSelOn(on) {
    try { localStorage.setItem(SEL_KEY, on ? "true" : "false"); } catch (e) {}
  }

  // ============================================================
  // API Key check — validates key against DeepSeek API
  // ============================================================
  function validateCode(code) {
    return httpPost(
      DS_API,
      { model: DS_MODEL, messages: [{ role: "user", content: "test" }], max_tokens: 8 },
      { "Content-Type": "application/json", "Authorization": "Bearer " + code }
    ).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 401) return { ok: false, error: "API Key 无效，请检查后重试" };
      return { ok: false, error: "DeepSeek 服务错误 (" + r.status + ")，请稍后重试" };
    }).catch(function () {
      return { ok: false, error: "无法连接 DeepSeek，请确认网络正常" };
    });
  }

  // ============================================================
  // API Key Modal
  // ============================================================
  function showActivationModal() {
    if (document.getElementById("ma-overlay")) return;

    // --- Overlay ---
    var overlay = document.createElement("div");
    overlay.id = "ma-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;" +
      "background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;";

    // --- Card ---
    var card = document.createElement("div");
    card.style.cssText =
      "background:#fff;border-radius:12px;padding:32px 28px 24px;" +
      "width:400px;max-width:92vw;box-shadow:0 8px 32px rgba(0,0,0,0.25);" +
      "font-family:system-ui,-apple-system,sans-serif;";

    card.innerHTML =
      '<h2 style="margin:0 0 8px;font-size:22px;color:#1a1a2e;">设置 API Key</h2>' +
      '<p style="margin:0 0 20px;font-size:14px;color:#6b7280;">' +
      '请输入 DeepSeek API Key（api.deepseek.com 申请）以启用翻译功能。</p>' +
      '<input id="ma-input" type="text" placeholder="sk-..." autocomplete="off" style="' +
      'width:100%;padding:12px 14px;border:2px solid #e5e7eb;border-radius:8px;' +
      'font-size:16px;outline:none;box-sizing:border-box;' +
      'transition:border-color 0.2s;">' +
      '<div id="ma-error" style="color:#dc3545;font-size:13px;margin-top:8px;min-height:20px;"></div>' +
      '<button id="ma-submit" style="' +
      'width:100%;margin-top:16px;padding:12px;background:#4a90d9;color:#fff;' +
      'border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;' +
      'transition:background 0.2s;">保存</button>' +
      '<p style="margin:12px 0 0;font-size:12px;color:#9ca3af;text-align:center;">' +
      'API Key 将自动保存，仅需输入一次。</p>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var input = document.getElementById("ma-input");
    var submit = document.getElementById("ma-submit");
    var errorEl = document.getElementById("ma-error");

    input.focus();
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit.click();
    });
    input.addEventListener("focus", function () { input.style.borderColor = "#4a90d9"; });
    input.addEventListener("blur", function () { input.style.borderColor = "#e5e7eb"; });

    submit.addEventListener("click", function () {
      var code = input.value.trim();
      if (!code) { errorEl.textContent = "请输入 API Key"; return; }

      submit.disabled = true;
      submit.textContent = "正在验证...";
      errorEl.textContent = "";

      validateCode(code).then(function (r) {
        if (r.ok) {
          setCode(code);
          card.innerHTML =
            '<div style="text-align:center;padding:20px 0;">' +
            '<div style="font-size:48px;margin-bottom:12px;">&#10003;</div>' +
            '<h2 style="margin:0 0 8px;font-size:20px;color:#28a745;">保存成功</h2>' +
            '<p style="color:#6b7280;font-size:14px;">页面即将刷新...</p></div>';
          setTimeout(function () { location.reload(); }, 1200);
        } else {
          errorEl.textContent = r.error || "API Key 无效，请检查后重试";
          submit.disabled = false;
          submit.textContent = "保存";
        }
      });
    });
  }

  // ============================================================
  // Translation API
  // ============================================================
  var TranslateAPI = {
    doTranslate: function (text, code) {
      return httpPost(
        DS_API,
        {
          model: DS_MODEL,
          messages: [
            { role: "system", content: MA_TRANSLATE_PROMPT },
            { role: "user", content: text },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        },
        { "Content-Type": "application/json", "Authorization": "Bearer " + code }
      ).then(function (r) {
        if (r.status === 401) { clearCode(); throw new Error("AUTH_FAIL"); }
        if (!r.ok) throw new Error("Server error: " + r.status);
        var data;
        try {
          data = JSON.parse(r._text);
        } catch (e) {
          throw new Error("DeepSeek 返回非 JSON（可能临时故障），稍后自动重试");
        }
        var content =
          data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : null;
        if (typeof content !== "string") throw new Error("翻译失败: 空响应");
        return fixDupPunct(content);
      });
    },
  };

  // ============================================================
  // Translation filtering (synced from PC translator.js)
  // ============================================================
  var LOCAL_DICTIONARY = {
    TODAY: "今天",
    "TOTAL EARNED": "总经验值",
    LESSON: "课程",
    REVIEW: "复习",
    "LINEAR ALGEBRA": "线性代数",
    "MULTIVARIABLE CALCULUS": "多变量微积分"
  };

  var BLACKLIST_TEXT_REGEX = /^[\d\s\/\.,\-]+(XP|%)?$/i;
  var BLACKLIST_DATE_REGEX = /^[A-Z][a-z]{2},\s+[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th),\s+\d{4}$/;
  var BLACKLIST_CLASS_PATTERNS = [
    "progress", "xp-ring", "avatar", "profile", "username",
    "leaderboard", "league", "ranking", "nav", "user", "member"
  ];

  function isBlacklistedText(text, hostNode) {
    if (!text) return true;
    var trimmed = text.trim();
    if (!trimmed || trimmed.length <= 1) return true;
    // Chinese re-entry check
    if (/[一-鿿]/.test(trimmed)) return true;
    // Short uppercase (avatar initials)
    if (trimmed.length <= 2 && /^[A-Z]+$/.test(trimmed)) return true;
    if (BLACKLIST_TEXT_REGEX.test(trimmed)) return true;
    if (BLACKLIST_DATE_REGEX.test(trimmed)) return true;
    // Username-like (letters+numbers, no spaces)
    if (!/\s/.test(trimmed) && /^[a-zA-Z]+[0-9]+[a-zA-Z0-9]*$/.test(trimmed)) return true;
    // DOM ancestor class check
    var parent = hostNode ? hostNode.parentElement : null;
    if (parent) {
      for (var i = 0; i < BLACKLIST_CLASS_PATTERNS.length; i++) {
        var p = parent;
        while (p && p !== document.body) {
          if (p.className && typeof p.className === "string" && p.className.indexOf(BLACKLIST_CLASS_PATTERNS[i]) !== -1) return true;
          p = p.parentElement;
        }
      }
    }
    return false;
  }

  function lookupLocalDict(text) {
    var key = text.trim().toUpperCase();
    return LOCAL_DICTIONARY[key] || null;
  }

  function isSameText(orig, translated) {
    var a = orig.trim().toLowerCase().replace(/\s+/g, "");
    var b = translated.toLowerCase().replace(/\s+/g, "");
    return a === b;
  }

  // ============================================================
  // LaTeX placeholder protection
  // ============================================================
  var Placeholder = { _n: 0, _m: null };
  Placeholder.reset = function () { this._n = 0; this._m = {}; };
  Placeholder._stash = function (s) { this._n++; var k = "{" + this._n + "}"; this._m[k] = s; return k; };
  // 剥离公式末尾标点，防止 LLM 双标点问题
  Placeholder._stripPunct = function (s) {
    var m = s.match(/[,，.。;；:：?？!！]+$/);
    return m ? s.slice(0, -m[0].length) : s;
  };
  Placeholder.protect = function (t) {
    var self = this;
    t = t.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g, function (m) { return self._stash(self._stripPunct(m)); });
    // 去掉 lookbehind（(?<!\\)）：iOS Safari <16.4 不支持负向后行断言，会导致整段解析失败。
    // 改写为捕获组：仅当 $ 前面不是反斜杠时才视为行内公式。
    t = t.replace(/(^|[^\\])\$([^$\n]+?)\$/g, function (m, p1, body) {
      return p1 + self._stash(self._stripPunct("$" + body + "$"));
    });
    t = t.replace(/(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})/g, function (m) { return self._stash(self._stripPunct(m)); });
    return t;
  };
  Placeholder.restore = function (t) {
    var keys = Object.keys(this._m || {});
    for (var i = 0; i < keys.length; i++) {
      t = t.split(keys[i]).join(this._m[keys[i]]);
    }
    return t;
  };

  // ============================================================
  // DOM helpers
  // ============================================================
  var SKIP = "script,style,noscript,code,pre,kbd,math,svg,canvas,iframe,img,video,audio,input,textarea,select,button,[data-ma-skip],.notranslate,.kiss-translator-wrapper,ma-trans";
  var CONTENT = "p,li,h1,h2,h3,h4,h5,h6,td,th,figcaption,dt,dd,blockquote,summary,label,legend";

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    var s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }

  function getText(el) {
    var c = el.cloneNode(true);
    var bad = c.querySelectorAll(SKIP);
    for (var i = 0; i < bad.length; i++) bad[i].remove();
    return (c.textContent || "").trim();
  }

  function shouldSkip(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.matches(SKIP)) return true;
    if (el.closest(SKIP)) return true;
    if (el.hasAttribute("data-ma-done")) return true;
    // Ancestor class blacklist (synced from PC)
    var ap = el.parentElement;
    while (ap) {
      if (ap.className && typeof ap.className === "string") {
        for (var bi = 0; bi < BLACKLIST_CLASS_PATTERNS.length; bi++) {
          if (ap.className.indexOf(BLACKLIST_CLASS_PATTERNS[bi]) !== -1) return true;
        }
      }
      if (ap === document.body) break;
      ap = ap.parentElement;
    }
    return false;
  }

  function findTranslatable(root) {
    var out = [];
    var all;
    try { all = root.querySelectorAll(CONTENT); } catch (e) { return out; }
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (shouldSkip(el)) continue;
      if (!isVisible(el)) continue;
      var t = getText(el);
      if (!t || t.length < 3) continue;
      if (/^[\s\$\{\}\[\]\\\_\^\{\}\(\)\+\-\*\/\=<>|:;,.\d\s]+$/.test(t)) continue;
      if (isBlacklistedText(t, el)) continue;
      out.push(el);
    }
    return out;
  }

  function createWrapper() {
    // 样式全部交给 CSS 控制（见 UI.init 的样式表），
    // 这样「全中文 / 双语对照」切换时只需换 <html> 的 class，无需重译。
    var w = document.createElement("ma-trans");
    return w;
  }

  // ============================================================
  // Translator engine
  // ============================================================
  var Translator = {
    _on: false,
    _obs: null,
    _pending: 0,
    _fails: 0,

    toggle: function () {
      this._on = !this._on;
      if (this._on) {
        this.startObserve();
        this.translateAll();
      } else {
        this.stopObserve();
        this.removeAll();
      }
      UI.refresh();
      return this._on;
    },

    removeAll: function () {
      var all = document.querySelectorAll("ma-trans");
      for (var i = 0; i < all.length; i++) all[i].remove();
    },

    translateOne: function (el) {
      if (!this._on) return Promise.resolve();
      var self = this;
      this._pending++;
      UI.refresh();

      var orig = getText(el);
      if (!orig || orig.length < 3) { this._pending--; UI.refresh(); return Promise.resolve(); }

      Placeholder.reset();
      var prot = Placeholder.protect(orig);
      var nat = prot.replace(/\{\d+\}/g, "").trim();
      if (!nat || nat.length < 2) { this._pending--; UI.refresh(); return Promise.resolve(); }

      // Local dictionary lookup (no API cost)
      var localTrans = lookupLocalDict(nat);
      if (localTrans) {
        if (isSameText(nat, localTrans)) { this._pending--; UI.refresh(); return Promise.resolve(); }
        if (!isVisible(el)) { this._pending--; UI.refresh(); return Promise.resolve(); }
        if (el.hasAttribute("data-ma-done")) { this._pending--; UI.refresh(); return Promise.resolve(); }
        var lw = createWrapper();
        lw.textContent = localTrans;
        el.classList.add("ma-orig");
        el.setAttribute("data-ma-done", "1");
        el.after(lw);
        this._pending--;
        UI.refresh();
        return Promise.resolve();
      }

      var code = getCode();
      return TranslateAPI.doTranslate(prot, code).then(function (result) {
        self._fails = 0;
        var restored = Placeholder.restore(result);
        // Same-text detection: skip if translation matches original
        if (!restored || isSameText(nat, restored)) { self._pending--; UI.refresh(); return; }
        if (!isVisible(el)) return;
        if (el.hasAttribute("data-ma-done")) return;
        var w = createWrapper();
        w.textContent = restored;
        el.classList.add("ma-orig");
        el.setAttribute("data-ma-done", "1");
        el.after(w);
        self._pending--;
        UI.refresh();
      }).catch(function (e) {
        self._pending--;
        UI.refresh();
        if (e.message === "AUTH_FAIL") {
          self._on = false;
          self.removeAll();
          self.stopObserve();
          UI.refresh();
          showActivationModal();
          return;
        }
        self._fails++;
        if (self._fails >= 5) {
          self._on = false;
          self.stopObserve();
          UI.refresh();
          showToast("翻译连续失败，已自动关闭。请检查网络后重试。");
        }
      });
    },

    translateAll: function () {
      var self = this;
      var els = findTranslatable(document.body);
      var total = els.length;
      UI._toastEl.textContent = "翻译中 0/" + total;
      UI._toastEl.style.opacity = "1";

      var i = 0;
      function next() {
        if (!self._on || i >= els.length) {
          UI._toastEl.style.opacity = "0";
          UI.refresh();
          return;
        }
        var batch = els.slice(i, i + 2);
        i += 2;
        return Promise.all(batch.map(function (el) { return self.translateOne(el); }))
          .then(function () { return sleep(400); })
          .then(next);
      }
      next();
    },

    // --- MutationObserver ---
    _debounce: null,

    startObserve: function () {
      if (this._obs) return;
      var self = this;
      this._obs = new MutationObserver(function (ms) {
        if (!self._on) return;
        var fresh = [];
        for (var i = 0; i < ms.length; i++) {
          var nodes = ms[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.nodeType !== 1) continue;
            if (isVisible(n) && n.matches(CONTENT) && !shouldSkip(n)) { fresh.push(n); }
            if (n.querySelectorAll) {
              var kids = n.querySelectorAll(CONTENT);
              for (var k = 0; k < kids.length; k++) {
                if (isVisible(kids[k]) && !shouldSkip(kids[k]) && fresh.indexOf(kids[k]) === -1) {
                  fresh.push(kids[k]);
                }
              }
            }
          }
        }
        if (fresh.length) {
          clearTimeout(self._debounce);
          self._debounce = setTimeout(function () {
            fresh.forEach(function (el) { self.translateOne(el); });
          }, 300);
        }
      });
      this._obs.observe(document.body, { childList: true, subtree: true });
    },

    stopObserve: function () {
      if (this._obs) { this._obs.disconnect(); this._obs = null; }
    },
  };

  // ============================================================
  // UI — Toast + FAB + Menu (matches desktop popup feel)
  // ============================================================
  var UI = {
    _fab: null,
    _menu: null,
    _backdrop: null,
    _toastEl: null,
    _init: false,

    init: function () {
      if (this._init) return;
      this._init = true;

      // Framework styles
      var style = document.createElement("style");
      style.textContent =
        // --- 译文 wrapper：双语模式下的蓝色卡片样式 ---
        "ma-trans{display:block;margin-top:0.4em;margin-bottom:0.8em;padding:6px 10px;" +
        "background:linear-gradient(135deg,#f0f7ff 0%,#e8f4fd 100%);" +
        "border-left:3px solid #4a90d9;border-radius:0 6px 6px 0;" +
        "font-size:0.92em;line-height:1.65;color:#2c3e50;" +
        "-webkit-tap-highlight-color:transparent;}" +
        // --- 全中文模式(默认)：隐藏原文，译文显示为普通段落(去掉卡片装饰，但保留段间距) ---
        "html.ma-mode-zh .ma-orig{display:none !important;}" +
        "html.ma-mode-zh ma-trans{margin:0 0 0.8em;padding:0;background:none;border-left:none;" +
        "border-radius:0;font-size:inherit;line-height:1.6;color:inherit;}" +
        // --- 双语模式：原文正常显示，译文用蓝卡(走上面 ma-trans 默认样式) ---
        "html.ma-mode-bi .ma-orig{display:revert;}" +
        "ma-fab{position:fixed;bottom:24px;right:24px;z-index:2147483646;width:52px;height:52px;" +
        "border-radius:50%;background:#4a90d9;color:#fff;display:flex;align-items:center;justify-content:center;" +
        "box-shadow:0 4px 16px rgba(74,144,217,0.45);-webkit-tap-highlight-color:transparent;" +
        "user-select:none;-webkit-user-select:none;transition:transform 0.2s,box-shadow 0.2s,background 0.2s;" +
        "touch-action:manipulation;}" +
        "ma-fab:active{transform:scale(0.92);box-shadow:0 2px 8px rgba(74,144,217,0.35);}" +
        "ma-fab.on{background:#28a745;box-shadow:0 4px 16px rgba(40,167,69,0.45);}" +
        "ma-fab svg{width:24px;height:24px;fill:currentColor;pointer-events:none;}" +
        "ma-menu{position:fixed;bottom:88px;right:24px;z-index:2147483645;background:#fff;" +
        "border-radius:14px;box-shadow:0 6px 28px rgba(0,0,0,0.18);width:220px;padding:6px 0;" +
        "font-family:system-ui,-apple-system,sans-serif;animation:ma-in 0.2s ease-out;}" +
        "ma-menu-item{display:flex;align-items:center;gap:8px;padding:11px 16px;font-size:14px;" +
        "color:#1f2937;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;" +
        "transition:background 0.15s;}" +
        "ma-menu-item:active{background:#f3f4f6;}" +
        "ma-menu-title{display:block;padding:12px 16px 8px;font-size:13px;font-weight:600;" +
        "color:#4a90d9;border-bottom:1px solid #f3f4f6;font-family:system-ui,-apple-system,sans-serif;}" +
        "ma-menu-tip{display:block;padding:4px 16px 8px;font-size:11px;color:#9ca3af;" +
        "font-family:system-ui,-apple-system,sans-serif;}" +
        "ma-switch{position:relative;width:38px;height:22px;border-radius:11px;background:#d1d5db;" +
        "flex:0 0 auto;transition:background 0.2s;}" +
        "ma-switch.on{background:#28a745;}" +
        "ma-switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;" +
        "border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);transition:transform 0.2s;}" +
        "ma-switch.on::after{transform:translateX(16px);}" +
        "ma-backdrop{position:fixed;inset:0;z-index:2147483644;}" +
        "ma-toast{position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "background:rgba(0,0,0,0.82);color:#fff;padding:10px 20px;border-radius:8px;" +
        "font-size:14px;font-family:system-ui,-apple-system,sans-serif;pointer-events:none;" +
        "opacity:0;transition:opacity 0.3s;white-space:nowrap;}" +
        "ma-sel-btn{position:absolute;z-index:2147483647;background:#4a90d9;color:#fff;" +
        "padding:5px 12px;border-radius:6px;font-size:13px;font-family:system-ui,-apple-system,sans-serif;" +
        "box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;-webkit-tap-highlight-color:transparent;" +
        "user-select:none;-webkit-user-select:none;white-space:nowrap;}" +
        "ma-sel-btn:active{background:#3a7bc8;}" +
        "ma-sel-box{position:absolute;z-index:2147483647;max-width:320px;background:#fff;color:#2c3e50;" +
        "padding:10px 14px;border-radius:8px;font-size:14px;line-height:1.6;" +
        "font-family:system-ui,-apple-system,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.22);" +
        "border:1px solid #e5e7eb;}" +
        "@keyframes ma-in{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}";
      document.head.appendChild(style);

      // Toast
      this._toastEl = document.createElement("ma-toast");
      this._toastEl.textContent = "";
      document.body.appendChild(this._toastEl);

      // FAB
      this._fab = document.createElement("ma-fab");
      this._fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.03 7.69 9.73 9.17 8.45 10.55 7.15 9.19 5.47 8 3.5 8v2c1.33 0 2.6.69 3.5 1.75A17.88 17.88 0 003 16h2a15.89 15.89 0 015.2-4.68l2.54 2.53 1.13-1.13zM20 2h-6v2h3v7h2V4h1V2zm-2 12h-2v-2h-2v2h-2v2h2v2h2v-2h2v-2z"/></svg>';

      var self = this;
      this._fab.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.toggleMenu();
      });

      document.body.appendChild(this._fab);
      this.refresh();
    },

    refresh: function () {
      if (!this._fab) return;
      if (Translator._on) {
        this._fab.classList.add("on");
      } else {
        this._fab.classList.remove("on");
      }
    },

    toggleMenu: function () {
      if (this._menu) { this.closeMenu(); return; }
      var self = this;

      this._backdrop = document.createElement("ma-backdrop");
      this._backdrop.addEventListener("click", function () { self.closeMenu(); });
      document.body.appendChild(this._backdrop);

      this._menu = document.createElement("ma-menu");
      this.rebuildPanel();
      document.body.appendChild(this._menu);
    },

    // PC popup 面板：翻译开关 / 划词翻译 / 双语对照 / 全中文显示 / 设置 API Key
    rebuildPanel: function () {
      if (!this._menu) return;
      var self = this;
      this._menu.innerHTML = "";

      var title = document.createElement("ma-menu-title");
      title.textContent = "MathAcademy 翻译助手";
      this._menu.appendChild(title);

      this._menu.appendChild(switchItem("翻译开关", Translator._on, function () {
        Translator.toggle(); self.rebuildPanel();
      }));
      this._menu.appendChild(switchItem("划词翻译", getSelOn(), function () {
        setSelOn(!getSelOn()); Selection.refresh(); self.rebuildPanel();
      }));
      this._menu.appendChild(switchItem("双语对照", getMode() === "bi", function () {
        setMode("bi"); self.rebuildPanel();
      }));
      this._menu.appendChild(switchItem("全中文显示", getMode() === "zh", function () {
        setMode("zh"); self.rebuildPanel();
      }));

      var tip = document.createElement("ma-menu-tip");
      tip.textContent = "双语对照和全中文显示不能同时开启";
      this._menu.appendChild(tip);

      this._menu.appendChild(menuItem("设置 API Key", function () {
        clearCode(); self.closeMenu();
        Translator._on = false; Translator.removeAll(); Translator.stopObserve();
        self.refresh(); showActivationModal();
      }));
    },

    closeMenu: function () {
      if (this._menu) { this._menu.remove(); this._menu = null; }
      if (this._backdrop) { this._backdrop.remove(); this._backdrop = null; }
    },
  };

  function menuItem(label, onClick, color) {
    var el = document.createElement("ma-menu-item");
    el.textContent = label;
    if (color) el.style.color = color;
    el.addEventListener("click", function (e) { e.stopPropagation(); onClick(); });
    return el;
  }

  // 带 iOS 风格开关的菜单项（对应 PC popup 的 Switch）
  function switchItem(label, on, onToggle) {
    var el = document.createElement("ma-menu-item");
    var txt = document.createElement("span");
    txt.textContent = label;
    txt.style.flex = "1";
    var sw = document.createElement("ma-switch");
    if (on) sw.className = "on";
    el.appendChild(txt);
    el.appendChild(sw);
    el.addEventListener("click", function (e) { e.stopPropagation(); onToggle(); });
    return el;
  }

  function showToast(msg) {
    UI._toastEl.textContent = msg;
    UI._toastEl.style.opacity = "1";
    clearTimeout(UI._toastTimer);
    UI._toastTimer = setTimeout(function () { UI._toastEl.style.opacity = "0"; }, 2500);
  }

  // ============================================================
  // Selection translation — 划词翻译 (选中文字 → 弹翻译按钮 → 翻译框)
  // ============================================================
  var Selection = {
    _btn: null,
    _box: null,
    _bound: false,

    enable: function () {
      if (this._bound) return;
      this._bound = true;
      var self = this;
      this._onUp = function () { setTimeout(function () { self._handle(); }, 10); };
      document.addEventListener("mouseup", this._onUp, true);
      document.addEventListener("touchend", this._onUp, true);
    },

    disable: function () {
      if (!this._bound) return;
      this._bound = false;
      document.removeEventListener("mouseup", this._onUp, true);
      document.removeEventListener("touchend", this._onUp, true);
      this._removeBtn();
      this._removeBox();
    },

    refresh: function () {
      if (getSelOn()) this.enable(); else this.disable();
    },

    _handle: function () {
      var sel = window.getSelection ? window.getSelection() : null;
      var text = sel ? String(sel).trim() : "";
      if (!text || text.length < 1) { this._removeBtn(); return; }
      // 跳过自身 UI 内的选择
      if (sel.anchorNode && sel.anchorNode.parentElement &&
          sel.anchorNode.parentElement.closest("ma-trans,ma-menu,ma-sel-box,ma-sel-btn")) return;
      try {
        var rect = sel.getRangeAt(0).getBoundingClientRect();
        this._showBtn(rect, text);
      } catch (e) {}
    },

    _showBtn: function (rect, text) {
      this._removeBtn();
      var self = this;
      var btn = document.createElement("ma-sel-btn");
      btn.textContent = "翻译";
      btn.style.left = (window.scrollX + rect.left) + "px";
      btn.style.top = (window.scrollY + rect.bottom + 6) + "px";
      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        self._translate(rect, text);
      });
      document.body.appendChild(btn);
      this._btn = btn;
    },

    _translate: function (rect, text) {
      var self = this;
      this._removeBtn();
      this._showBox(rect, "翻译中...");
      Placeholder.reset();
      var prot = Placeholder.protect(text);
      TranslateAPI.doTranslate(prot, getCode()).then(function (result) {
        self._showBox(rect, Placeholder.restore(result));
      }).catch(function (e) {
        self._showBox(rect, e.message === "AUTH_FAIL" ? "API Key 已失效，请重新设置" : "翻译失败，请重试");
      });
    },

    _showBox: function (rect, content) {
      this._removeBox();
      var self = this;
      var box = document.createElement("ma-sel-box");
      box.textContent = content;
      box.style.left = (window.scrollX + rect.left) + "px";
      box.style.top = (window.scrollY + rect.bottom + 6) + "px";
      document.body.appendChild(box);
      this._box = box;
      this._boxAway = function (ev) {
        if (self._box && !self._box.contains(ev.target)) self._removeBox();
      };
      setTimeout(function () {
        document.addEventListener("mousedown", self._boxAway, true);
        document.addEventListener("touchstart", self._boxAway, true);
      }, 0);
    },

    _removeBtn: function () { if (this._btn) { this._btn.remove(); this._btn = null; } },
    _removeBox: function () {
      if (this._box) { this._box.remove(); this._box = null; }
      if (this._boxAway) {
        document.removeEventListener("mousedown", this._boxAway, true);
        document.removeEventListener("touchstart", this._boxAway, true);
        this._boxAway = null;
      }
    },
  };

  // ============================================================
  // Helpers
  // ============================================================
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ============================================================
  // Init
  // ============================================================
  function bindShortcuts() {
    document.addEventListener("keydown", function (e) {
      if (!e.altKey) return;
      var k = (e.key || "").toLowerCase();
      if (k === "q") {            // Alt+Q 开关翻译
        e.preventDefault();
        Translator.toggle();
        UI.rebuildPanel();
      } else if (k === "k") {     // Alt+K 打开/关闭 popup
        e.preventDefault();
        UI.toggleMenu();
      }
    }, true);
  }

  function init() {
    UI.init();
    applyMode(getMode());   // 默认全中文模式（与 PC 一致）
    bindShortcuts();

    var code = getCode();
    if (!code) {
      showActivationModal();
      return;
    }

    // Validate stored code
    validateCode(code).then(function (r) {
      if (r.ok) {
        Translator._on = true;
        Translator.startObserve();
        UI.refresh();
        Translator.translateAll();
        Selection.refresh();   // 划词翻译默认开启
      } else {
        clearCode();
        showActivationModal();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
