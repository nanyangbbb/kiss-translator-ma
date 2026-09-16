import { browser } from "./browser";

/**
 * 获取当前tab信息
 * @returns
 */
export const getCurTab = async () => {
  const [tab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return tab;
};

export const getCurTabId = async () => {
  const tab = await getCurTab();
  return tab?.id;
};

/**
 * 发送消息给background
 * @param {*} action
 * @param {*} args
 * @returns
 */
export const sendBgMsg = (action, args) => {
  const p = browser?.runtime.sendMessage({ action, args });
  // 预挂一个空 catch：防止调用方忘记处理（如 background 抛
  // "Message action is unavailable"）产生 unhandled rejection；
  // 调用方 await p 时仍能正常拿到错误。
  if (p && typeof p.catch === "function") {
    p.catch(() => {});
  }
  return p;
};

/**
 * 发送消息给当前页面
 * @param {*} action
 * @param {*} args
 * @returns
 */
export const sendTabMsg = async (action, args) => {
  const tabId = await getCurTabId();
  if (!tabId) return;
  return browser.tabs.sendMessage(tabId, { action, args }).catch((err) => {
    if (
      err?.message?.includes("Could not establish connection") ||
      err?.message?.includes("Receiving end does not exist")
    ) {
      console.warn("sendTabMsg warning: ", err?.message);
    } else {
      throw err;
    }
  });
};
