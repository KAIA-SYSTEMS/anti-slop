import { RuleTester } from "oxlint/plugins-dev";

import { noMockingRule } from "./no-mocking.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const mocking = { messageId: "mocking" };
const mockAssertion = { messageId: "mockAssertion" };
const mockImport = { messageId: "mockImport" };

tester.run("anti-slop/no-mocking", noMockingRule, {
  valid: [
    "const store = new InMemoryUserStore();",
    "expect(x).toBe(1);",
    "const vi = { mock() {}, fn() {}, spyOn() {} }; vi.mock(); vi.fn(); vi.spyOn();",
    "function test(jest: { mock(): void }) { jest.mock(); }",
    "import { vi as localVi } from './helpers'; localVi.mock('./module');",
    "import { vi } from './helpers'; vi.fn();",
    "import { jest } from './helpers'; jest.spyOn(store, 'save');",
    "const service = { mock() {} }; service.mock();",
    "vi.useFakeTimers(); jest.setSystemTime(0);",
    "vi[method]();",
    "service.mock; service.calls; service.mock.other; service[method]();",
    "import { Mock } from './types';",
    "import { expect, test, type ExpectStatic } from 'vitest';",
    "import 'fake-indexeddb'; import { MemoryStorage } from './memory-storage';",
    "import FakeTimers from '@sinonjs/fake-timers';",
    "import client from 'msw-extra'; import helper from 'sinon-helper';",
    "import helper from '@example/helper'; import('./helper'); require('./helper');",
    "import(moduleName); require(moduleName); require();",
    { code: "import 'sinon'; import('msw/node'); require('nock');", options: [{ modules: [] }] },
    { code: "import 'msw';", options: [{ modules: ["custom-mocks"] }] },
    { code: "import 'custom-mocks-extra';", options: [{ modules: ["custom-mocks"] }] },
    { code: "import 'custom-mocks';", options: [{}] },
  ],
  invalid: [
    ...[
      "fn", "spyOn", "mock", "doMock", "unmock", "doUnmock", "unstable_mockModule",
      "importMock", "importActual", "mocked", "hoisted", "stubGlobal", "stubEnv",
      "unstubAllGlobals", "unstubAllEnvs", "restoreAllMocks", "resetAllMocks", "clearAllMocks",
      "isMockFunction",
    ].flatMap((method) => [
      { code: `vi.${method}();`, errors: [mocking] },
      { code: `jest.${method}();`, errors: [mocking] },
    ]),
    { code: "vi['fn']();", errors: [mocking] },
    { code: "jest['spyOn'](store, 'save');", errors: [mocking] },
    { code: "import { vi } from 'vitest'; vi.mock('./user-store');", errors: [mocking] },
    { code: "import { vi as testApi } from 'vitest'; testApi.fn();", errors: [mocking] },
    { code: "import { jest } from '@jest/globals'; jest.spyOn(store, 'save');", errors: [mocking] },
    { code: "import { jest as testApi } from '@jest/globals'; testApi['doMock']('./store');", errors: [mocking] },
    ...[
      "mockImplementation", "mockImplementationOnce", "mockReturnValue", "mockReturnValueOnce",
      "mockResolvedValue", "mockResolvedValueOnce", "mockRejectedValue", "mockRejectedValueOnce",
      "mockReturnThis", "mockClear", "mockReset", "mockRestore", "mockName",
    ].map((method) => ({ code: `handler.${method}();`, errors: [mocking] })),
    { code: "handler['mockReturnValue'](1);", errors: [mocking] },
    { code: "handler.mockName('save').mockReturnThis();", errors: [mocking, mocking] },
    ...[
      "toHaveBeenCalled", "toHaveBeenCalledTimes", "toHaveBeenCalledWith", "toHaveBeenLastCalledWith",
      "toHaveBeenNthCalledWith", "toHaveBeenCalledOnce", "toHaveReturned", "toHaveReturnedTimes",
      "toHaveReturnedWith", "toHaveLastReturnedWith", "toHaveNthReturnedWith", "toBeCalled",
      "toBeCalledTimes", "toBeCalledWith", "lastCalledWith", "nthCalledWith", "toReturn",
      "toReturnTimes", "toReturnWith", "lastReturnedWith", "nthReturnedWith",
    ].map((method) => ({ code: `expect(handler).${method}();`, errors: [mockAssertion] })),
    { code: "expect(handler).not.toHaveBeenCalled();", errors: [mockAssertion] },
    { code: "expect(p).resolves.toHaveReturnedWith(1);", errors: [mockAssertion] },
    { code: "expect(p).rejects.toHaveBeenCalledWith('error');", errors: [mockAssertion] },
    { code: "expect(handler)['toBeCalled']();", errors: [mockAssertion] },
    { code: "assertions.toHaveBeenCalled();", errors: [mockAssertion] },
    ...["calls", "results", "lastCall", "instances", "invocationCallOrder"].map((property) => ({
      code: `const value = handler.mock.${property};`, errors: [mockAssertion],
    })),
    { code: "expect(handler.mock.calls).toHaveLength(1);", errors: [mockAssertion] },
    { code: "const value = handler['mock']['calls'];", errors: [mockAssertion] },
    ...["vitest", "@jest/globals", "jest-mock"].flatMap((module) =>
      ["Mock", "MockInstance", "Mocked", "MockedFunction", "MockedObject", "MockedClass"].flatMap((name) => [
        { code: `import { ${name} } from '${module}';`, errors: [mockImport] },
        { code: `import type { ${name} as LocalType } from '${module}';`, errors: [mockImport] },
      ]),
    ),
    { code: "import { type Mock, type Mocked } from 'vitest';", errors: [mockImport, mockImport] },
    ...[
      "sinon", "msw", "nock", "fetch-mock", "vitest-mock-extended", "jest-mock-extended",
      "ts-mockito", "testdouble", "aws-sdk-client-mock",
    ].flatMap((module) => [
      { code: `import library from '${module}';`, errors: [mockImport] },
      { code: `import('${module}');`, errors: [mockImport] },
      { code: `require('${module}');`, errors: [mockImport] },
    ]),
    { code: "import { setupServer } from 'msw/node';", errors: [mockImport] },
    { code: "import('msw/node');", errors: [mockImport] },
    { code: "require('msw/node');", errors: [mockImport] },
    { code: "import type { Options } from 'sinon';", errors: [mockImport] },
    { code: "import 'msw';", options: [{}], errors: [mockImport] },
    { code: "import 'custom-mocks';", options: [{ modules: ["custom-mocks"] }], errors: [mockImport] },
    { code: "import('custom-mocks/node');", options: [{ modules: ["custom-mocks"] }], errors: [mockImport] },
    { code: "require('@example/mocks/server');", options: [{ modules: ["@example/mocks"] }], errors: [mockImport] },
    { code: "vi.fn();", options: [{ modules: [] }], errors: [mocking] },
  ],
});
