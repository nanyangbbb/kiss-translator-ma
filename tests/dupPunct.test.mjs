import test from "node:test";
import assert from "node:assert/strict";
import { fixDupPunct } from "../src/libs/dupPunct.js";

test("dedups duplicated CJK punctuation around {N} placeholders", () => {
  assert.equal(fixDupPunct("因此，{1}，我们得到"), "因此，{1}我们得到");
  assert.equal(fixDupPunct("结果。{2}。完毕"), "结果。{2}完毕");
  assert.equal(fixDupPunct("分号；{3}；测试"), "分号；{3}测试");
});

test("keeps normal punctuation combinations", () => {
  assert.equal(fixDupPunct("因此，{1}。句号收尾"), "因此，{1}。句号收尾");
  assert.equal(fixDupPunct("普通中文，句子。"), "普通中文，句子。");
  assert.equal(fixDupPunct("{1}，开头"), "{1}，开头");
});

test("handles whitespace between punct and placeholder", () => {
  assert.equal(fixDupPunct("所以， {4} ，这样"), "所以，{4}这样");
});

test("passes through non-string and fast-path", () => {
  assert.equal(fixDupPunct(null), null);
  assert.equal(fixDupPunct(123), 123);
  assert.equal(fixDupPunct("no placeholders here，真的"), "no placeholders here，真的");
});
