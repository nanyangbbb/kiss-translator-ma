#!/usr/bin/env zx

console.log(chalk.cyan("\nBuilding Android Userscript...\n"));

const srcFile = "build/web/kiss-translator.user.js";
const destFile = "build/web/kiss-translator-android.user.js";
const userscriptDir = "build/userscript";

try {
  if (!fs.existsSync(srcFile)) {
    throw new Error(
      `Source file not found: ${srcFile}. Run 'pnpm build:web' first.`
    );
  }

  await fs.copy(srcFile, destFile);
  let content = await fs.readFile(destFile, "utf-8");

  // Android 浏览器（X、Via）的脚本引擎不支持 @grant unsafeWindow
  // 去掉所有 @grant / @connect / @downloadURL / @updateURL
  // 注意：不能用 \s* 前缀，会把 \n 也匹配掉导致行拼接级联 bug
  // 改用 ^[\t ]* 只匹配行首空格/tab，不吞换行
  [
    /^[\t ]*\/\/\s*@grant\s+.*\n/gm,
    /^[\t ]*\/\/\s*@connect\s+.*\n/gm,
    /^[\t ]*\/\/\s*@downloadURL\s+.*\n/gm,
    /^[\t ]*\/\/\s*@updateURL\s+.*\n/gm,
  ].forEach((re) => {
    content = content.replace(re, "");
  });

  // 确保 ==/UserScript== 在独立行上（修复级联 bug 导致的行拼接）
  content = content.replace(/([^\n])\/\/ ==\/UserScript==/, "$1\n// ==/UserScript==");

  // 给 @name 加 Android 后缀，与桌面版区分，避免脚本管理器混淆
  content = content.replace(
    /\/\/ @name\s+.*/,
    "// @name          MathAcademy Translator (Android)"
  );

  // 添加 @include 以兼容不支持 @match 的引擎，同时也匹配根域名
  content = content.replace(
    "// ==/UserScript==",
    "// @include       *://mathacademy.com/*\n// @include       *://*.mathacademy.com/*\n// ==/UserScript=="
  );

  // 所有注入内容 — 一个替换操作避免顺序问题
  const injectedCode = `
/* --- MathAcademy Android GM Polyfill --- */
(function(){
  // Android 浏览器（X、Via）没有沙箱，GM API 不存在。提供 polyfill。
  if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
    return; // 已有完整 GM，无需 polyfill
  }

  var NS = 'kiss_tr_';
  window.unsafeWindow = window;

  window.GM_setValue = function(key, val) {
    try { localStorage.setItem(NS + key, val); } catch(e) {}
    return Promise.resolve(val);
  };
  window.GM_getValue = function(key) {
    var val = null;
    try { val = localStorage.getItem(NS + key); } catch(e) {}
    return Promise.resolve(val);
  };
  window.GM_deleteValue = function(key) {
    try { localStorage.removeItem(NS + key); } catch(e) {}
    return Promise.resolve();
  };

  // GM_xmlhttpRequest polyfill：用原生 fetch 实现。
  window.GM_xmlhttpRequest = function(details) {
    var aborted = false;
    var controller = new AbortController();
    var timer = null;

    if (details.timeout) {
      timer = setTimeout(function() {
        aborted = true;
        controller.abort();
        if (details.ontimeout) details.ontimeout();
      }, details.timeout);
    }

    var fetchHeaders = {};
    if (details.headers && typeof details.headers === 'object' && !Array.isArray(details.headers)) {
      fetchHeaders = details.headers;
    }

    fetch(details.url, {
      method: details.method || 'GET',
      headers: fetchHeaders,
      body: details.data || undefined,
      signal: controller.signal,
    }).then(function(res) {
      if (aborted) return;
      clearTimeout(timer);
      var hdrStr = '';
      res.headers.forEach(function(v, k) { hdrStr += k + ': ' + v + '\\n'; });
      return res.text().then(function(body) {
        if (details.onload) {
          details.onload({
            status: res.status,
            statusText: res.statusText,
            response: body,
            responseHeaders: hdrStr,
            readyState: 4,
          });
        }
      });
    }).catch(function(err) {
      if (aborted) return;
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (details.onabort) details.onabort();
      } else {
        if (details.onerror) details.onerror(err);
      }
    });

    return { abort: function() {
      aborted = true;
      controller.abort();
      clearTimeout(timer);
    }};
  };

  window.GM_registerMenuCommand = function() {};
  window.GM_unregisterMenuCommand = function() {};
  window.GM_info = {
    script: {
      name: 'KISS Translator',
      version: '${process.env.REACT_APP_VERSION || "2.0.21"}',
      grant: [],
    }
  };

  // X Browser 的 GM 是引擎注入的只读词法绑定（bare GM !== window.GM），
  // 改 window.GM 无法影响代码里的裸 GM 引用。因此关键是提供 window.KISS_GM，
  // fetchGM/fetchStreamGM 会优先使用它（见 src/libs/fetch.js）。
  window.KISS_GM = {
    fetch: function(input, init) {
      return new Promise(function(resolve, reject) {
        window.GM_xmlhttpRequest({
          method: (init && init.method) || 'GET',
          url: input,
          headers: init && init.headers,
          data: init && init.body,
          timeout: init && init.timeout,
          onload: function(resp) {
            var hdrs = {};
            if (resp.responseHeaders) {
              resp.responseHeaders.split('\\n').forEach(function(line) {
                var parts = line.split(':');
                if (parts.length >= 2) {
                  hdrs[parts[0].trim()] = parts.slice(1).join(':').trim();
                }
              });
            }
            resolve({ body: resp.response, headers: hdrs, status: resp.status, statusText: resp.statusText });
          },
          onerror: reject,
          ontimeout: function() { reject(new Error('timeout')); },
          onabort: function() { reject(new Error('aborted')); }
        });
      });
    },
    xmlHttpRequest: window.GM_xmlhttpRequest,
    setValue: window.GM_setValue,
    getValue: window.GM_getValue,
    deleteValue: window.GM_deleteValue
  };

  // 尽力补全 window.GM（部分引擎可写），失败也无妨——KISS_GM 是主通道。
  try {
    window.GM = window.GM || {};
    window.GM.xmlHttpRequest = window.GM_xmlhttpRequest;
    window.GM.setValue = window.GM_setValue;
    window.GM.getValue = window.GM_getValue;
    window.GM.deleteValue = window.GM_deleteValue;
    window.GM.registerMenuCommand = window.GM_registerMenuCommand;
    window.GM.unregisterMenuCommand = window.GM_unregisterMenuCommand;
    window.GM.info = window.GM_info;
  } catch(e) {}
})();
`;

  // 一次性注入所有代码 — 替换一次避免顺序问题
  content = content.replace("// ==/UserScript==", "// ==/UserScript==\n" + injectedCode);

  await fs.writeFile(destFile, content, "utf-8");

  await fs.ensureDir(userscriptDir);
  const androidDest = path.join(userscriptDir, path.basename(destFile));
  await fs.copy(destFile, androidDest);

  console.log(chalk.green(`✅ Android Userscript at: ${destFile}`));
} catch (err) {
  console.error(chalk.red("❌ Error building Android userscript:"), err);
  process.exit(1);
}
