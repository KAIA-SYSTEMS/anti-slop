import { defineRule } from "@oxlint/plugins";

import { isPackageImport } from "../shared/imported-module.ts";
import { isTestFrameworkObject, memberName } from "../shared/test-framework.ts";

const timerMethods = new Set([
  "useFakeTimers", "useRealTimers", "setSystemTime", "getMockedSystemTime",
  "advanceTimersByTime", "advanceTimersByTimeAsync", "advanceTimersToNextTimer",
  "advanceTimersToNextTimerAsync", "runAllTimers", "runAllTimersAsync",
  "runOnlyPendingTimers", "runOnlyPendingTimersAsync", "clearAllTimers",
]);
const timerModules = ["@sinonjs/fake-timers"];

/** Ban fake clocks and timer manipulation in tests. */
export const noFakeTimersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow fake timers; test through the real interface and real timer behavior.",
    },
    messages: {
      fakeTimers: "Test through the real interface and real timer behavior instead of replacing the system clock or timers.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "require") {
          const source = node.arguments[0];
          if (source !== undefined && source.type !== "SpreadElement" && isPackageImport(source, timerModules)) {
            context.report({ node, messageId: "fakeTimers" });
          }
        }
        if (callee.type !== "MemberExpression") return;
        const name = memberName(callee);
        if (name !== null && timerMethods.has(name) && isTestFrameworkObject(context.sourceCode, callee.object)) {
          context.report({ node, messageId: "fakeTimers" });
        }
      },
      ImportDeclaration(node) {
        if (isPackageImport(node.source, timerModules)) context.report({ node, messageId: "fakeTimers" });
      },
      ImportExpression(node) {
        if (isPackageImport(node.source, timerModules)) context.report({ node, messageId: "fakeTimers" });
      },
    };
  },
});
