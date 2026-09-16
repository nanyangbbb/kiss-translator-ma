import { logger } from "./log";
import DOMPurify from "dompurify";

export const trustedTypesHelper = (() => {
  const POLICY_NAME = "kiss-translator-policy";
  let policy = null;

  if (globalThis.trustedTypes && globalThis.trustedTypes.createPolicy) {
    try {
      policy = globalThis.trustedTypes.createPolicy(POLICY_NAME, {
        createHTML: (string) => DOMPurify.sanitize(string),
        createScript: (string) => string,
        createScriptURL: (string) => string,
      });
    } catch (err) {
      if (err.message.includes("already exists")) {
        policy = globalThis.trustedTypes.policies.get(POLICY_NAME);
      } else {
        logger.info("cont create Trusted Types", err);
      }
    }
  }

  return {
    createHTML: (htmlString) => {
      // 无条件消毒：Trusted Types 在未启用的页面（如 mathacademy.com）拿不到，
      // 旧实现此时直接返回原始 HTML（等于没有 DOMPurify），译文/术语/占位符回填
      // 若含恶意片段会经 innerHTML 造成页面 XSS。先 sanitize，再包装（可选）。
      const clean = DOMPurify.sanitize(htmlString);
      return policy ? policy.createHTML(clean) : clean;
    },
    createScript: (scriptString) => {
      return policy ? policy.createScript(scriptString) : scriptString;
    },
    createScriptURL: (urlString) => {
      return policy ? policy.createScriptURL(urlString) : urlString;
    },
    isEnabled: () => policy !== null,
  };
})();
