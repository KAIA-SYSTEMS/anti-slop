# Kaia anti-slop

Kaia Systems' maintained fork of
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).

Opinionated Oxlint rules that reject low-evidence and low-signal TypeScript and JavaScript patterns.

This project is meant to be vendored, not treated as a fixed npm dependency. Copy the rules into your repository, read them, and change them to match your team's standards. The bundled agent skill handles the initial copy and configuration; after that, the vendored files are yours to maintain and make your own.

The Kaia ruleset enables all rules. It narrows a few upstream checks to keep them
high-signal: exact object contracts and dynamic dictionary accumulators preserve
evidence, runtime `typeof` is rejected specifically for explicitly `unknown`
inputs, `shape` is checked in declarations under our control rather than external
member names, and unavoidable raw `unknown` parameters require a substantive
nearby `BOUNDARY:` comment.

## Install with an agent skill

```bash
npx skills add KAIA-SYSTEMS/anti-slop --skill install-anti-slop
```

Then ask your coding agent to install or configure anti-slop in the current repository. The skill copies the plugin, installs current Oxlint dependencies, merges the plugin into the existing lint configuration, enables every rule, and validates the result.

To inspect available skills first:

```bash
npx skills add KAIA-SYSTEMS/anti-slop --list
```

## Manual local installation

Copy `src/` into the target repository, for example at `tools/oxlint/anti-slop/`, and install matching current versions of `oxlint` and `@oxlint/plugins`.

Register the copied entry point in `oxlint.config.ts`:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-mocking": "error",
    "anti-slop/no-fake-timers": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-unsafe-map-type": "error",
    "anti-slop/no-unsafe-utility-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error"
  }
});
```

The same `jsPlugins` entry and rules work under `lint` in a Vite+ config.

## Rules

- `no-chained-type-assertions` — rejects nested type assertions that fabricate evidence.
- `no-conditional-empty-object-spread` — rejects conditional spreads that use `{}` to omit fields.
- `no-known-value-widening` — rejects known values widened to `unknown`, `object`, or open dictionaries while permitting exact object contracts and genuinely dynamic dictionary accumulators.
- `no-mocking` — rejects Vitest and Jest mocks, spies, stubs, mock configuration and inspection, mock matchers, mock type/value imports, and mocking libraries; test through the real interface.
- `no-fake-timers` — rejects Vitest and Jest fake clock/timer APIs and imports from `@sinonjs/fake-timers`; use real timer behavior.
- `no-object-parameters` — rejects the broad `object` type on function inputs.
- `no-reflect-apply` — rejects `Reflect.apply` in favor of typed function calls.
- `no-reflect-get` — rejects `Reflect.get` in favor of typed property access or boundary parsing.
- `no-runtime-typeof` — requires schema decoding instead of ad hoc `typeof` narrowing for explicitly `unknown` values; typed-union branching and feature detection remain valid.
- `no-shape-in-symbol-names` — rejects `shape` in locally controlled declaration names without banning external member access such as `schema.shape`.
- `no-unknown-parameters` — rejects `unknown` inputs unless a nearby `BOUNDARY:` comment names the unavoidable raw source and callers decode it immediately.
- `no-unknown-returns` — rejects function contracts that return `unknown` or `Promise<unknown>`.
- `no-unknown-type-aliases` — rejects aliases that merely conceal `unknown`.
- `no-unsafe-dictionary-type` — rejects dictionary value contracts based on `unknown`, `any`, `object`, `Object`, `{}`, and same-file aliases, including generic/defaulted aliases and index-signature interfaces.
- `no-unsafe-map-type` — rejects loose `Map`/`ReadonlyMap` value types, explicit constructor arguments, same-file constructor aliases/destructuring, local generic factory/class contracts, and standalone empty maps without a type annotation in TypeScript files. Concrete contextually typed maps, JavaScript empty maps, and `WeakMap` remain valid.
- `no-unsafe-utility-type` — rejects `Readonly`, `Partial`, `Required`, `Pick`, and `Omit` applied to loose source contracts rather than concrete owner types.
- `no-widen-then-assert` — rejects local flows that widen known values and later assert them back.
- `require-safety-comment-for-type-assertion` — requires each non-const assertion to document its checked invariant.

## Scope and performance

These rules use Oxlint's ESTree and lexical scopes, without starting a TypeScript
compiler, reading imported files, or loading another parser. Rule regression tests
run through `pnpm test`, never during linting.

The bounded local analysis covers:

- Same-file aliases/interfaces, supplied generic arguments, and unsafe defaults
  at alias/interface declarations, even when the declaration is not used.
- Nested container properties, arrays, `NoInfer`, direct loose `Awaited` values,
  and literal property/tuple indexed types.
- Constant constructor aliases, object/array destructuring, and parameters with
  `typeof Map` or destructured `typeof globalThis` contracts.
- `typeof` queries over explicit annotations and their literal projections,
  including destructured/rest bindings in straight-line code.
- Local generic factories with explicit return annotations or a single return
  expression; returned object properties and nongeneric arrow closures; class
  inheritance, instance fields, and constructor parameter properties.
- Omitted generic arguments on context-free, zero-argument calls/construction
  when the local declaration has no input parameters; defaults and constraints
  are honored. Argument and contextual inference are not guessed.

This is not compiler-backed semantic analysis. Conditional types/`infer`, general
utility-type evaluation, imported contracts, namespace/re-export chains, and
arbitrary function bodies remain outside its scope. Queries needing control-flow
narrowing and mutated/escaping constructor holders are deliberately skipped.
Empty maps inside calls or object literals may receive a contextual contract from
another file, so the rule does not assume they are untyped. Run the project's
normal typecheck separately, noting that TypeScript itself does not enforce these
stylistic bans on otherwise-valid broad types.

Object dictionary and explicit map contracts reject loose values regardless of
whether keys are finite, numeric, or arbitrary strings. A string-key-only semantic
gate therefore has a different policy and should not be treated as equivalent.

## Violation examples

Each snippet below is rejected by the named rule.

### `no-chained-type-assertions`

```ts
const user = input as object as User;
```

### `no-conditional-empty-object-spread`

```ts
const options = {
  ...(timeout !== undefined ? { timeout } : {}),
};
```

### `no-known-value-widening`

```ts
const handlers: Record<string, Handler> = {
  start: startHandler,
};
```

This discards the known `start` key. Preserve inference or use `satisfies Record<string, Handler>` instead.

A genuinely dynamic accumulator remains valid:

```ts
const handlers: Record<string, Handler> = {};
handlers[name] = handler;
```

### `no-mocking`

Reports Vitest and Jest mock factories, spies, module mocking/unmocking, mocked
imports, hoisting, global/environment stubs and mock lifecycle APIs. It also
reports mock configuration methods on any receiver, reads of `.mock.calls`,
`.mock.results`, `.mock.lastCall`, `.mock.instances`, and `.mock.invocationCallOrder`,
and call/return mock matchers, including after `.not`, `.resolves`, or `.rejects`.
Computed string member access counts too.

Framework APIs are recognised from `vitest`, `vite-plus/test`, `@vitest/spy`,
`@jest/globals`, and `jest-mock`, including namespace imports, `jest-mock` default
interop, static-string dynamic imports, `require()` and stable loader aliases.
Free `vi`/`jest` names and their properties on unshadowed `globalThis`, `global`,
`window`, and `self` are recognised. Same-file analysis follows stable bindings,
static object/array members and known spreads, destructuring (including rest),
erased TypeScript wrappers, sequence/conditional/logical expressions, and
`.bind()`, `.call()`, and `.apply()`. Computed keys can use string literals,
interpolation-free templates, string concatenation, and constant string bindings.
Wildcard framework re-exports expose mocking tools and are reported; erased
factory-type imports/exports are allowed, while explicit mock-type names remain
banned.

Analysis stops at reassigned bindings, unknown keys/spreads, and holders changed
by assignments, deletion, or known object/array mutators, including through local
aliases. It does not trace static class fields, getters, arbitrary functions or
Promise `.then()` import callbacks, ambient declarations without runtime
provenance, `new Function` code, cross-file barrels, or mock configuration/matcher
method aliases. Recursive projections, keys, branches, and spread expansion are
bounded, and each factory lookup has a work limit; unresolved or exhausted paths
produce no factory diagnostic.

Bad:

```ts
vi.mock("./user-store");
const save = vi.fn().mockResolvedValue(user);
expect(save).toHaveBeenCalledWith(user);
```

Good — call the real interface and assert its observable behavior:

```ts
const saved = await userStore.save(user);
expect(await userStore.findById(saved.id)).toEqual(saved);
```

Imports of `Mock`, `MockInstance`, `Mocked`, `MockedFunction`, `MockedObject`, and
`MockedClass` from `vitest`, `vite-plus/test`, `@vitest/spy`, `@jest/globals`, or
`jest-mock` are reported, including type-only imports. Static imports, dynamic
`import()`, and `require()` of mocking
libraries are also reported, as are re-exports of banned libraries or named
framework mocking APIs.

The `modules` option replaces the default banned package list:
`sinon`, `msw`, `nock`, `fetch-mock`, `vitest-mock-extended`, `jest-mock-extended`,
`ts-mockito`, `testdouble`, `aws-sdk-client-mock`, and `@vitest/spy`. Each package
also matches its subpaths, such as `msw/node`.

```ts
"anti-slop/no-mocking": ["error", { modules: ["msw", "custom-mocks"] }]
```

An empty list disables the library import check; mock APIs, metadata, matchers,
and framework mock type/value imports are still reported. `fake-indexeddb` and
memory storage are allowed by default.

### `no-fake-timers`

Reports Vitest and Jest calls to `useFakeTimers`, `useRealTimers`, `setSystemTime`,
`getMockedSystemTime`, `advanceTimersByTime`, `advanceTimersByTimeAsync`,
`advanceTimersToNextTimer`, `advanceTimersToNextTimerAsync`, `runAllTimers`,
`runAllTimersAsync`, `runOnlyPendingTimers`, `runOnlyPendingTimersAsync`, and
`clearAllTimers`, including computed string access. Static imports, dynamic
`import()`, and `require()` from `@sinonjs/fake-timers` and its subpaths are reported.

Bad:

```ts
vi.useFakeTimers();
vi.advanceTimersByTime(100);
```

Good — await completion through the real interface:

```ts
const result = await scheduler.runAfter(100, () => "ready");
expect(result).toBe("ready");
```

### `no-object-parameters`

```ts
function save(value: object) {}
```

### `no-reflect-apply`

```ts
const value = Reflect.apply(operation, owner, args);
```

### `no-reflect-get`

```ts
const value = Reflect.get(owner, key);
```

### `no-runtime-typeof`

```ts
function decode(input: unknown) {
  if (typeof input === "string") {
    useName(input);
  }
}
```

Decode the boundary with a schema instead. `typeof` over a typed union and
feature detection such as `typeof Headers !== "undefined"` remain valid.

### `no-shape-in-symbol-names`

```ts
interface UserShape {
  id: string;
}
```

### `no-unknown-parameters`

```ts
function handle(input: unknown) {}
```

When a framework or external protocol makes `unknown` unavoidable, document the
source and decode immediately:

```ts
// BOUNDARY: message is raw JSON supplied by the WebSocket peer.
function handle(message: unknown) {
  return Schema.decodeUnknownSync(MessageSchema)(message);
}
```

### `no-unknown-returns`

```ts
function loadUser(): unknown {
  return input;
}
```

### `no-unknown-type-aliases`

```ts
type ExternalValue = unknown;
```

### `no-unsafe-dictionary-type`

```ts
type Metadata = Record<string, unknown>;
type OtherMetadata = { [key: string]: object };
```

### `no-widen-then-assert`

```ts
const loaded: User = loadUser();
const stored: unknown = loaded;
const user = stored as User;
```

### `require-safety-comment-for-type-assertion`

```ts
const userId = value as UserId;
```

Add a specific justification immediately before a necessary assertion:

```ts
// SAFETY: parseUserId validated the identifier before branding it.
const userId = value as UserId;
```

This rule covers TypeScript `as Type` assertions and angle-bracket assertions.
It does not cover `as const`, `satisfies`, ordinary type annotations, or
non-null (`!`) assertions.

## Development

```bash
pnpm install
pnpm check
```

`src/` is canonical. After changing production source, run `pnpm sync:skill-assets`; CI checks that the skill's bundled copy remains identical.

## License

MIT
