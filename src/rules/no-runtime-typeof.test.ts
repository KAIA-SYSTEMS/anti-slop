import { RuleTester } from "oxlint/plugins-dev";

import { noRuntimeTypeofRule } from "./no-runtime-typeof.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "runtimeTypeof" };

tester.run("anti-slop/no-runtime-typeof", noRuntimeTypeofRule, {
  valid: [
    "function format(value: string | number) { return typeof value === 'string' ? value : String(value) }",
    "const supported = typeof Headers !== 'undefined'",
    "function call(callback: (() => void) | undefined) { if (typeof callback === 'function') callback() }",
  ],
  invalid: [
    {
      code: "function decode(value: unknown) { return typeof value === 'string' ? value : null }",
      errors: [error],
    },
    {
      code: "const value: unknown = input; if (typeof value === 'object') use(value)",
      errors: [error],
    },
  ],
});
