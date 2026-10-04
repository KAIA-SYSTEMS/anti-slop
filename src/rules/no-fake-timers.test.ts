import { RuleTester } from "oxlint/plugins-dev";

import { noFakeTimersRule } from "./no-fake-timers.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "fakeTimers" };

tester.run("anti-slop/no-fake-timers", noFakeTimersRule, {
  valid: [
    "await new Promise((resolve) => setTimeout(resolve, 10));",
    "expect(x).toBe(1);",
    "vi.fn(); vi.spyOn(store, 'save'); jest.mock('./store');",
    "const vi = { useFakeTimers() {} }; vi.useFakeTimers();",
    "function test(jest: { setSystemTime(time: number): void }) { jest.setSystemTime(0); }",
    "import { vi } from './helpers'; vi.useFakeTimers();",
    "import { jest as localJest } from './helpers'; localJest.runAllTimers();",
    "const clock = { useFakeTimers() {} }; clock.useFakeTimers();",
    "vi[method]();",
    "import 'fake-indexeddb'; import { MemoryStorage } from './memory-storage';",
    "import 'sinon'; import 'msw/node';",
    "import './clock'; import('./clock'); require('./clock');",
    "import '@sinonjs/fake-timers-extra';",
    "import(moduleName); require(moduleName); require();",
  ],
  invalid: [
    ...[
      "useFakeTimers", "useRealTimers", "setSystemTime", "getMockedSystemTime",
      "advanceTimersByTime", "advanceTimersByTimeAsync", "advanceTimersToNextTimer",
      "advanceTimersToNextTimerAsync", "runAllTimers", "runAllTimersAsync",
      "runOnlyPendingTimers", "runOnlyPendingTimersAsync", "clearAllTimers",
    ].flatMap((method) => [
      { code: `vi.${method}();`, errors: [error] },
      { code: `jest.${method}();`, errors: [error] },
    ]),
    { code: "vi['useFakeTimers']();", errors: [error] },
    { code: "jest['advanceTimersByTimeAsync'](100);", errors: [error] },
    { code: "import { vi } from 'vitest'; vi.useFakeTimers();", errors: [error] },
    { code: "import { vi as clock } from 'vitest'; clock.setSystemTime(0);", errors: [error] },
    { code: "import { jest } from '@jest/globals'; jest.runAllTimers();", errors: [error] },
    { code: "import { jest as clock } from '@jest/globals'; clock['useRealTimers']();", errors: [error] },
    { code: "import FakeTimers from '@sinonjs/fake-timers';", errors: [error] },
    { code: "import type { Clock } from '@sinonjs/fake-timers';", errors: [error] },
    { code: "import('@sinonjs/fake-timers');", errors: [error] },
    { code: "require('@sinonjs/fake-timers');", errors: [error] },
    { code: "import '@sinonjs/fake-timers/src/fake-timers-src.js';", errors: [error] },
  ],
});
