/**
 * 双逗号修复（移植自服务端 _fix_dup_punct）。
 *
 * 模型偶尔在占位符 {N}（前端把公式/换行序列化成 {1}{2}… 送翻）两侧重复输出
 * 同一中文标点，如"，{2}，"——前端还原换行占位符后页面显示双逗号。
 * 只归一中文标点的重复：LaTeX/代码不含中文标点，零误伤；
 * "，{1}。"这类逗号+句号的正常组合不受影响（正则要求两侧是同一标点）。
 * 注：流式渲染路径不经过此处，双逗号修复对非流式翻译生效。
 */
const DUP_PUNCT_RE = /([，。；])\s*(\{\d+\})\s*\1/g;

export function fixDupPunct(content) {
  if (typeof content !== "string") {
    return content;
  }
  if (!/[，。；]\s*\{/.test(content)) {
    return content;
  }
  return content.replace(DUP_PUNCT_RE, "$1$2");
}
