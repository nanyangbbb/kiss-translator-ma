/**
 * 主世界注入脚本：读 MathAcademy 页面的 window._topics（知识点 ID→name 映射），
 * 序列化成精简的 {id: name} 写入 <html data-ma-topics>，供隔离世界的 content script 读回。
 *
 * 为什么需要它：content script 跑在隔离世界，读不到页面 window._topics；
 * 内联脚本又被 MA 的 CSP 拦截。本文件作为扩展外部资源（chrome-extension://）
 * 注入主世界，CSP 允许，能在主世界执行读到 _topics。
 */
(function () {
  try {
    var topics = window._topics;
    if (!topics) return;
    var map = {};
    Object.keys(topics).forEach(function (k) {
      if (topics[k] && topics[k].name) map[k] = topics[k].name;
    });
    document.documentElement.setAttribute(
      "data-ma-topics",
      JSON.stringify(map)
    );
  } catch (e) {}
})();
