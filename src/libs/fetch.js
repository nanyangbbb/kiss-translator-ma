import { isExt, isGm } from "./client";
import { sendBgMsg } from "./msg";
import { getSettingWithDefault } from "./storage";
import { MSG_FETCH, DEFAULT_HTTP_TIMEOUT, PORT_STREAM_FETCH } from "../config";
import { isBg } from "./browser";
import { kissLog } from "./log";
import { getFetchPool } from "./pool";
import { getHttpCachePolyfill, parseResponse } from "./cache";
import { createSSEParser, createAsyncQueue } from "./stream";
import browser from "webextension-polyfill";

/**
 * 油猴脚本的请求封装
 * @param {*} input
 * @param {*} init
 * @returns
 */
export const fetchGM = async (
  input,
  { method = "GET", headers, body, timeout } = {}
) =>
  new Promise((resolve, reject) => {
    // Android 浏览器（X/Via）的 GM 是引擎词法绑定，window.GM 改不到它，
    // 上面也没有 xmlHttpRequest。优先用我们自己注入的 KISS_GM.xmlHttpRequest。
    const gmXHR =
      (typeof window !== "undefined" &&
        window.KISS_GM &&
        window.KISS_GM.xmlHttpRequest) ||
      GM.xmlHttpRequest;
    gmXHR({
      method,
      url: input,
      headers,
      data: body,
      // withCredentials: true,
      timeout,
      onload: ({ response, responseHeaders, status, statusText }) => {
        const headers = {};
        try {
          responseHeaders &&
            responseHeaders.split("\n").forEach((line) => {
              const [name, value] = line.split(":").map((item) => item.trim());
              if (name && value) {
                headers[name] = value;
              }
            });
        } catch (e) {
          kissLog("fetchGM parse headers error", e);
        }

        resolve({
          body: response,
          headers,
          status,
          statusText,
        });
      },
      onerror: reject,
      onabort: () => {
        reject(new Error("GM request onabort."));
      },
      ontimeout: () => {
        reject(new Error("GM request timeout."));
      },
    });
  });

/**
 * 发起请求
 * @param {*} input
 * @param {*} init
 * @param {*} opts
 * @returns
 */
export const fetchPatcher = async (input, init = {}, opts) => {
  let timeout = opts?.httpTimeout;
  if (!timeout) {
    try {
      timeout = (await getSettingWithDefault()).httpTimeout;
    } catch (err) {
      kissLog("getSettingWithDefault", err);
    }
  }
  if (!timeout) {
    timeout = DEFAULT_HTTP_TIMEOUT;
  }

  if (isGm) {
    // todo: 自定义接口 init 可能包含了 signal
    Object.assign(init, { timeout });

    const { body, headers, status, statusText } = window.KISS_GM
      ? await window.KISS_GM.fetch(input, init)
      : await fetchGM(input, init);

    return new Response(body, {
      headers: new Headers(headers),
      status,
      statusText,
    });
  }

  if (AbortSignal?.timeout && !init.signal) {
    Object.assign(init, { signal: AbortSignal.timeout(timeout) });
  } else if (!init.signal) {
    // 旧环境无 AbortSignal.timeout：手动 AbortController + setTimeout 回退，
    // 否则请求永不超时、翻译管线永久挂起
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    const origSignal = init.signal || null;
    init.signal = ac.signal;
    const wrapped = fetch(input, init);
    wrapped.finally(() => clearTimeout(timer)).catch(() => {});
    // 保留调用方信号联动
    if (origSignal) {
      origSignal.addEventListener(
        "abort",
        () => ac.abort(),
        { once: true }
      );
    }
    return wrapped;
  }

  return fetch(input, init);
};

/**
 * 处理请求
 * @param {*} param0
 * @returns
 */
export const fetchHandle = async ({ input, init, opts }) => {
  const res = await fetchPatcher(input, init, opts);
  return parseResponse(res, opts.expect);
};

/**
 * fetch 兼容性封装
 * @param {*} args
 * @returns
 */
export const fnPolyfill = ({ fn, msg = MSG_FETCH, ...args }) => {
  // 插件
  if (isExt && !isBg()) {
    return sendBgMsg(msg, { ...args });
  }

  // 油猴/网页/BackgroundPage
  return fn({ ...args });
};

/**
 * 数据请求
 * @param {*} input
 * @param {*} init
 * @param {*} param1
 * @returns
 */
export const fetchData = async (
  input,
  init,
  { useCache, usePool, fetchInterval, fetchLimit, ...opts } = {}
) => {
  if (!input?.trim()) {
    throw new Error("URL is empty");
  }

  // 使用缓存数据
  if (useCache) {
    const resCache = await getHttpCachePolyfill(input, init);
    if (resCache) {
      return resCache;
    }
  }

  // 通过任务池发送请求
  if (usePool) {
    const fetchPool = getFetchPool(fetchInterval, fetchLimit);
    return fetchPool.push(fnPolyfill, { fn: fetchHandle, input, init, opts });
  }

  // 直接请求
  return fnPolyfill({ fn: fetchHandle, input, init, opts });
};

/**
 * 油猴脚本流式请求（带 SSE 处理）
 * @param {*} input
 * @param {*} init
 * @returns {AsyncGenerator<string>}
 */
async function* fetchStreamGM(
  input,
  { method = "GET", headers, body, timeout } = {}
) {
  const asyncQueue = createAsyncQueue();
  const parseSSE = createSSEParser();

  const gmRequest = window.KISS_GM?.xmlHttpRequest || GM.xmlHttpRequest;
  const requestHandle = gmRequest({
    method,
    url: input,
    headers,
    data: body,
    timeout,
    responseType: "stream",
    onloadstart: async ({ response }) => {
      try {
        const reader = response.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone) break;
          for (const data of parseSSE(
            decoder.decode(value, { stream: true })
          )) {
            asyncQueue.push(data);
          }
        }
      } catch (e) {
        asyncQueue.error(e);
        return;
      }
      asyncQueue.finish();
    },
    onerror: (e) => asyncQueue.error(e),
    onabort: () => asyncQueue.error(new Error("GM stream request aborted")),
    ontimeout: () => asyncQueue.error(new Error("GM stream request timeout")),
  });

  try {
    yield* asyncQueue.iterate();
  } finally {
    requestHandle?.abort?.();
  }
}

/**
 * 原生 fetch 流式请求（带 SSE 处理）
 * @param {string} input
 * @param {Object} init
 * @param {number} timeout
 * @returns {AsyncGenerator<string>}
 */
export async function* fetchStreamNative(input, init, timeout) {
  const signal = AbortSignal?.timeout?.(timeout);
  const response = await fetch(input, { ...init, signal });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parseSSE = createSSEParser();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    for (const data of parseSSE(decoder.decode(value, { stream: true }))) {
      yield data;
    }
  }
}

/**
 * 通过端口连接 background 的流式请求
 * @param {string} input
 * @param {Object} init
 * @param {Object} opts
 * @returns {AsyncGenerator<string>}
 */
async function* fetchStreamViaPort(input, init, opts) {
  const asyncQueue = createAsyncQueue();

  let port;
  try {
    port = browser.runtime.connect({ name: PORT_STREAM_FETCH });
  } catch (e) {
    throw new Error("Failed to connect to background: " + e.message);
  }

  port.onMessage.addListener((message) => {
    switch (message.type) {
      case "delta":
        asyncQueue.push(message.data);
        break;
      case "done":
        asyncQueue.finish();
        break;
      case "error":
        asyncQueue.error(new Error(message.error));
        break;
      default:
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    const lastError = browser.runtime.lastError;
    // 扩展重载 / SW 被回收 / 崩溃时 lastError 常为 undefined，
    // 旧实现只在有 lastError 时报错 → 生成器永久挂起、loading 永不结束。
    // 无条件结束：有错误报错，无错误视为异常中断。
    asyncQueue.error(
      new Error(lastError?.message || "Port disconnected (extension reloaded?)")
    );
  });

  port.postMessage({
    action: "start",
    args: { input, init, opts },
  });

  try {
    yield* asyncQueue.iterate();
  } finally {
    port.disconnect();
  }
}

/**
 * 流式请求处理（油猴/BackgroundPage/Web）
 * @param {string} input
 * @param {Object} init
 * @param {Object} opts
 * @returns {AsyncGenerator<string>}
 */
async function* fnPolyfillStream(input, init, opts) {
  opts = {
    ...opts,
    httpTimeout: opts?.httpTimeout || DEFAULT_HTTP_TIMEOUT,
  };

  // 插件 content script，通过端口连接 background
  if (isExt && !isBg()) {
    yield* fetchStreamViaPort(input, init, opts);
    return;
  }

  // 油猴脚本环境
  if (isGm) {
    yield* fetchStreamGM(input, { ...init, timeout: opts?.httpTimeout });
    return;
  }

  // 扩展 background 或 Web 环境，使用原生 fetch
  yield* fetchStreamNative(input, init, opts?.httpTimeout);
}

/**
 * 流式请求统一封装
 * @param {string} input 请求 URL
 * @param {Object} init 请求配置
 * @param {Object} options 选项（与 fetchData 一致）
 * @yields {string} SSE 数据片段
 */
export async function* fetchStream(
  input,
  init,
  { useCache, usePool, fetchInterval, fetchLimit, ...opts } = {}
) {
  if (!input?.trim()) {
    throw new Error("URL is empty");
  }

  // 使用缓存数据
  if (useCache) {
    const resCache = await getHttpCachePolyfill(input, init);
    if (resCache) {
      yield resCache;
      return;
    }
  }

  // 通过任务池发送请求
  if (usePool) {
    const fetchPool = getFetchPool(fetchInterval, fetchLimit);
    const asyncQueue = createAsyncQueue();

    const streamPromise = fetchPool.push(async () => {
      try {
        for await (const chunk of fnPolyfillStream(input, init, opts)) {
          asyncQueue.push(chunk);
        }
        asyncQueue.finish();
      } catch (e) {
        asyncQueue.error(e);
      }
      return null;
    });

    yield* asyncQueue.iterate();
    await streamPromise;
    return;
  }

  // 直接请求
  yield* fnPolyfillStream(input, init, opts);
}
