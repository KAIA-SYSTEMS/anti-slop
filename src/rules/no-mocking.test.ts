import { RuleTester } from "oxlint/plugins-dev";

import { noMockingRule } from "./no-mocking.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const mocking = { messageId: "mocking" };
const mockAssertion = { messageId: "mockAssertion" };
const mockImport = { messageId: "mockImport" };

tester.run("anti-slop/no-mocking", noMockingRule, {
  valid: [
    "import { vi } from 'vitest'; let make = vi.fn; function replace() { make = realFunction; } make();",
    "import { vi } from 'vitest'; let make = vi.fn; [make] = [realFunction]; make();",
    "import { vi } from 'vitest'; const mocks = { make: vi.fn }; mocks.make = realFunction; mocks.make();",
    "import { vi } from 'vitest'; const mocks = [vi.fn]; mocks[0] = realFunction; mocks[0]();",
    "import { vi } from 'vitest'; const { fn, ...api } = vi; api.fn();",
    "import { vi } from 'vitest'; const mocks = { make: vi.fn, ...other }; mocks.make();",
    "import { vi } from 'vitest'; const mocks = [other, ...items, vi.fn]; mocks[1]();",
    "import { vi } from 'vitest'; const mocks = { [method]: vi.fn }; mocks.make();",
    "function work(require: (name: string) => { vi: { fn(): void } }) { require('vitest').vi.fn(); }",
    "const { vi } = await import('./helper'); vi.fn();",
    "const { jest } = require('./helper'); jest.fn();",
    "export { vi } from 'vite-plus/test'; export { jest } from '@jest/globals';",
    "export { fn } from './helpers'; export * from 'msw-extra';",
    { code: "export * from 'msw';", options: [{ modules: [] }] },
    "export { vi } from \"vitest\";", // B17
    "import vitest from \"vitest\"; vitest.vi.fn();", // B24
    "import { vi } from \"vitest\"; const make = vi.fn.bind(vi);", // B36
    "const vi = { fn() {} }; vi.fn();", // F01
    "import { vi } from \"./helper\"; vi.fn();", // F02
    "function work(vi: { fn(): void }) { vi.fn(); }", // F03
    "const object = { fn() {} }; object.fn();", // F04
    "Array.prototype.bind?.(Array);", // F05
    "import { vi } from \"vitest\"; function work() { const vi = { fn() {} }; const make = vi.fn; make(); }", // F06
    "const other = { fn() {} }; const makeStub = other.fn; makeStub();", // F07
    "import { vi } from \"vitest\"; const f = vi.fn; function work(f: () => void) { f(); }", // F10
    "const other = { fn() {} }; const f = other.fn.bind(other); f();", // F11
    "import { vi } from \"vitest\"; let f = vi.fn; f = () => 1; f();", // F12
    "import type { vi } from \"vitest\"; declare const instance: typeof vi; instance.fn();", // F13
    "const arr = []; const fn = Array.prototype.map.bind(arr); fn(x => x);", // F14
    "const store = new InMemoryUserStore();",
    "expect(x).toBe(1);",
    "const vi = { mock() {}, fn() {}, spyOn() {} }; vi.mock(); vi.fn(); vi.spyOn();",
    "function test(jest: { mock(): void }) { jest.mock(); }",
    "import { vi as localVi } from './helpers'; localVi.mock('./module');",
    "import { vi } from './helpers'; vi.fn();",
    "import { jest } from './helpers'; jest.spyOn(store, 'save');",
    "function makeStub() {} makeStub(); function stubFn() {} stubFn(); function spyOn() {} spyOn();",
    "const vi = { fn() {}, spyOn() {} }; const makeStub = vi.fn; makeStub(); const { fn: stubFn, spyOn } = vi; stubFn(); spyOn(); const spy = vi.spyOn.bind(vi); spy(); const m = vi; m.fn();",
    "import { vi } from './helpers'; const makeStub = vi.fn; makeStub(); const { fn: stubFn } = vi; stubFn(); const m = vi; m.fn();",
    "import { fn, spyOn } from './helpers'; fn(); spyOn();",
    "import { vi } from 'vitest'; function test(vi: { fn(): void }) { const makeStub = vi.fn; makeStub(); const m = vi; m.fn(); }",
    "import { jest } from '@jest/globals'; function test(jest: { spyOn(): void }) { const spy = jest.spyOn.bind(jest); spy(); }",
    "import { vi } from 'vitest'; const { useFakeTimers: clock } = vi; clock();",
    "import { vi } from 'vite-plus/test'; vi.useFakeTimers();",
    "import { vi } from 'vitest'; const makeStub = service.fn; makeStub();",
    "import { vi } from 'vitest'; const { [method]: stubFn } = vi; stubFn();",
    "import { vi } from 'vitest'; const { fn: stubFn = fallback } = service; stubFn();",
    "import { vi } from 'vitest'; let makeStub = vi.fn; makeStub = realFunction; makeStub();",
    "import { vi } from 'vitest'; let m = vi; m = service; m.fn();",
    "const makeStub = stubFn; const stubFn = makeStub; makeStub();",
    "const vi = service; const jest = service; const m = vi; m.fn(); const j = jest; j.spyOn();",
    "const store = { save() {} }; const alias = store; alias.save();",
    "import { vi } from 'vitest'; const makeStub = vi.fn; function test(makeStub: () => void) { makeStub(); }",
    "import { vi } from 'vitest-extra'; const makeStub = vi.fn; makeStub();",
    "import { vi } from 'vite-plus/test-extra'; const m = vi; m.fn();",
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
      ["vitest", "vi"],
      ["vite-plus/test", "vi"],
      ["@jest/globals", "jest"],
    ].flatMap(([module, api]) => [
      { code: `import * as ns from '${module}'; ns.${api}.spyOn(store, 'save');`, errors: [mocking] },
      { code: `const { ${api} } = await import('${module}'); ${api}.mock('./service');`, errors: [mocking] },
      { code: `const api = (await import('${module}')).${api}; api.fn();`, errors: [mocking] },
      { code: `const { ${api} } = require('${module}'); ${api}.spyOn(store, 'save');`, errors: [mocking] },
      { code: `require('${module}').${api}.fn();`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const make = ${api}.fn; make.call(${api}); make.apply(${api}, []);`, errors: [mocking, mocking] },
    ]),
    ...["@vitest/spy", "jest-mock"].flatMap((module) => [
      { code: `import { spyOn as spy } from '${module}'; spy(store, 'save');`, options: [{ modules: [] }], errors: [mocking] },
      { code: `const { fn: make } = await import('${module}'); make();`, options: [{ modules: [] }], errors: [mocking] },
      { code: `const make = require('${module}').fn; make();`, options: [{ modules: [] }], errors: [mocking] },
      { code: `require('${module}').spyOn(store, 'save');`, options: [{ modules: [] }], errors: [mocking] },
    ]),
    ...["vi.fn as typeof vi.fn", "<typeof vi.fn>vi.fn", "(vi.fn)", "vi.fn!", "vi.fn satisfies typeof vi.fn"].map((expression) => ({
      code: `import { vi } from 'vitest'; const make = ${expression}; make();`, errors: [mocking],
    })),
    { code: "import { vi } from 'vitest'; (vi.fn as typeof vi.fn)(); vi.fn!();", errors: [mocking, mocking] },
    { code: "import { vi } from 'vitest'; const mocks = { ['make']: vi.fn }; const { make } = mocks; make();", errors: [mocking] },
    { code: "import { vi } from 'vitest'; const mocks = { nested: [vi.fn] }; mocks.nested[0]();", errors: [mocking] },
    { code: "import { vi } from 'vitest'; const { spyOn, ...api } = vi; api.fn();", errors: [mocking] },
    { code: "import { vi } from 'vitest'; const [first, ...api] = [null, vi.fn]; api[0]();", errors: [mocking] },
    { code: "import { vi } from 'vitest'; const mocks = { make: vi.fn, make: realFunction, make: vi.fn }; mocks.make();", errors: [mocking] },
    ...["sinon", "msw", "nock", "fetch-mock", "vitest-mock-extended", "jest-mock-extended", "ts-mockito", "testdouble", "aws-sdk-client-mock", "@vitest/spy"].flatMap((module) => [
      { code: `export { fn as make } from '${module}';`, errors: [mockImport] },
      { code: `export * from '${module}';`, errors: [mockImport] },
    ]),
    { code: "export { fn as make } from 'jest-mock';", errors: [mockImport] },
    { code: "export { fn } from '@vitest/spy';", options: [{ modules: [] }], errors: [mockImport] },
    { code: "export type { Mock } from 'vite-plus/test';", errors: [mockImport] },
    { code: "export * from 'msw/node';", errors: [mockImport] },
    { code: "export { make } from 'custom-mocks/node';", options: [{ modules: ["custom-mocks"] }], errors: [mockImport] },
    { code: "export * from 'custom-mocks';", options: [{ modules: ["custom-mocks"] }], errors: [mockImport] },
    { code: "import * as spy from \"@vitest/spy\"; spy.fn();", errors: [mockImport, mocking] }, // B01
    { code: "import { fn as stub } from \"@vitest/spy\"; stub();", errors: [mockImport, mocking] }, // B02
    { code: "const { vi } = await import(\"vitest\"); vi.fn();", errors: [mocking] }, // B03
    { code: "const vi2 = require(\"vitest\").vi; vi2.fn();", errors: [mocking] }, // B04
    { code: "import { vi } from \"vitest\"; const mocks = { make: vi.fn }; mocks.make();", errors: [mocking] }, // B05
    { code: "import { vi } from \"vitest\"; const make = () => vi.fn(); make();", errors: [mocking] }, // B06
    { code: "import { vi } from \"vitest\"; [vi.fn][0]();", errors: [mocking] }, // B07
    { code: "import { vi } from \"vitest\"; const f = vi[\"fn\"]; f();", errors: [mocking] }, // B08
    { code: "import { vi } from \"vitest\"; let f = vi.fn; f();", errors: [mocking] }, // B09
    { code: "import { vi } from \"vitest\"; const make = vi.fn.bind(vi); make();", errors: [mocking] }, // B10
    { code: "import { vi } from \"vitest\"; const mockModule = vi.mock; mockModule(\"./service\");", errors: [mocking] }, // B11
    { code: "import { vi } from \"vitest\"; const { mock } = vi; mock(\"./service\");", errors: [mocking] }, // B12
    { code: "import { jest } from \"@jest/globals\"; const mocks = { make: jest.fn }; mocks.make();", errors: [mocking] }, // B13
    { code: "const { jest } = await import(\"@jest/globals\"); jest.fn();", errors: [mocking] }, // B14
    { code: "import { vi as v } from \"vite-plus/test\"; const make = v.fn; make();", errors: [mocking] }, // B15
    { code: "import type { Mock } from \"vitest\";", errors: [mockImport] }, // B16 / F09
    { code: "export { fn as makeStub } from \"@vitest/spy\";", errors: [mockImport] }, // B18
    { code: "import { fn as makeStub } from \"jest-mock\"; makeStub();", errors: [mocking] }, // B19
    { code: "import * as mocks from \"jest-mock\"; mocks.fn();", errors: [mocking] }, // B20
    { code: "import * as vitest from \"vitest\"; vitest.vi.fn();", errors: [mocking] }, // B21
    { code: "import * as globals from \"@jest/globals\"; globals.jest.fn();", errors: [mocking] }, // B22
    { code: "import mocks from \"jest-mock\"; mocks.fn();", errors: [mocking] }, // B23
    { code: "import { vi } from \"vitest\"; const [make] = [vi.fn]; make();", errors: [mocking] }, // B25
    { code: "import { vi } from \"vitest\"; vi.fn.call(vi);", errors: [mocking] }, // B26
    { code: "import { vi } from \"vitest\"; vi.fn.apply(vi, []);", errors: [mocking] }, // B27
    { code: "import { vi } from \"vitest\"; const make = vi.fn satisfies typeof vi.fn; make();", errors: [mocking] }, // B28
    { code: "import { vi } from \"vitest\"; const make = vi.fn!; make();", errors: [mocking] }, // B29
    { code: "import { vi } from \"vitest\"; const { ...api } = vi; api.fn();", errors: [mocking] }, // B30
    { code: "import type { Mock } from \"@vitest/spy\";", errors: [mockImport] }, // B31 / F08
    { code: "const { fn: stub } = await import(\"@vitest/spy\"); stub();", errors: [mockImport, mocking] }, // B32
    { code: "import * as spy from \"@vitest/spy\"; spy.fn();", options: [{ modules: [] }], errors: [mocking] }, // B33
    { code: "const { vi } = require(\"vitest\"); vi.fn();", errors: [mocking] }, // B34
    { code: "import { jest } from \"@jest/globals\"; let make = jest.fn; make();", errors: [mocking] }, // B37
    { code: "const v = (await import(\"vitest\")).vi; v.fn();", errors: [mocking] }, // B38
    { code: "import { vi } from \"vitest\"; vi.fn.bind(vi)();", errors: [mocking] }, // B39
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
      ["vitest", "vi"],
      ["vite-plus/test", "vi"],
      ["@jest/globals", "jest"],
    ].flatMap(([module, api]) => [
      { code: `import { ${api} } from '${module}'; ${api}.fn();`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const makeStub = ${api}.fn; makeStub();`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const { fn: stubFn, spyOn } = ${api}; stubFn(); spyOn();`, errors: [mocking, mocking] },
      { code: `import { ${api} } from '${module}'; const spy = ${api}.spyOn.bind(${api}); spy(store, 'save');`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const m = ${api}; m.fn();`, errors: [mocking] },
      { code: `import { ${api} as testApi } from '${module}'; const makeStub = testApi['fn']; const another = makeStub; another();`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const m = ${api}; const { spyOn: spy } = m; spy(store, 'save');`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const m = ${api}; const another = m; another['spyOn'](store, 'save');`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const { ['fn']: stubFn } = ${api}; stubFn();`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const { fn: stubFn = fallback } = ${api}; stubFn();`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const makeStub = ${api}.fn; function test() { makeStub(); }`, errors: [mocking] },
      { code: `import { ${api} } from '${module}'; const makeStub = ${api}.fn; const spy = makeStub.bind(${api}); spy();`, errors: [mocking] },
    ]),
    { code: "const makeStub = vi.fn; makeStub();", errors: [mocking] },
    { code: "const { fn: stubFn, spyOn } = vi; stubFn(); spyOn();", errors: [mocking, mocking] },
    { code: "const spy = vi.spyOn.bind(vi); spy();", errors: [mocking] },
    { code: "const m = vi; m.fn();", errors: [mocking] },
    { code: "const makeStub = jest.fn; makeStub();", errors: [mocking] },
    { code: "const { fn: stubFn, spyOn } = jest; stubFn(); spyOn();", errors: [mocking, mocking] },
    { code: "const spy = jest.spyOn.bind(jest); spy();", errors: [mocking] },
    { code: "const m = jest; m.fn();", errors: [mocking] },
    { code: "import { vi } from '@vitest/spy'; vi.fn();", errors: [mockImport, mocking] },
    { code: "import { fn, spyOn } from '@vitest/spy'; fn(); spyOn(store, 'save');", errors: [mockImport, mocking, mocking] },
    { code: "import { fn as makeStub } from '@vitest/spy'; const stubFn = makeStub; stubFn();", errors: [mockImport, mocking] },
    { code: "import { vi } from '@vitest/spy'; const makeStub = vi.fn; makeStub();", errors: [mockImport, mocking] },
    { code: "import { vi } from '@vitest/spy'; const { fn: stubFn, spyOn } = vi; stubFn(); spyOn();", errors: [mockImport, mocking, mocking] },
    { code: "import { vi } from '@vitest/spy'; const spy = vi.spyOn.bind(vi); spy();", errors: [mockImport, mocking] },
    { code: "import { vi } from '@vitest/spy'; const m = vi; m.fn();", errors: [mockImport, mocking] },
    { code: "import * as spies from '@vitest/spy'; spies.fn();", errors: [mockImport, mocking] },
    { code: "import * as spies from '@vitest/spy'; const { fn: stubFn } = spies; stubFn();", errors: [mockImport, mocking] },
    { code: "import { fn } from '@vitest/spy'; fn();", options: [{ modules: [] }], errors: [mocking] },
    { code: "import('@vitest/spy');", errors: [mockImport] },
    { code: "require('@vitest/spy');", errors: [mockImport] },
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
