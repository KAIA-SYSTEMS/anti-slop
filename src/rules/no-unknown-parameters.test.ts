import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownParameter" };

tester.run("anti-slop/no-unknown-parameters", noUnknownParametersRule, {
  valid: [
    "function consume(value: User) {}",
    "// BOUNDARY: Fetch supplies untrusted JSON decoded immediately below.\nfunction decode(value: unknown) {}",
    "function decode(/* BOUNDARY: The driver owns this raw callback value. */ value: unknown) {}",
    "// BOUNDARY: The SDK owns every callback value in this interface.\ninterface Callbacks { receive(value: unknown): void }",
  ],
  invalid: [
    { code: "function consume(value: unknown) {}", errors: [error] },
    { code: "function consume(cause: unknown) {}", errors: [error] },
    { code: "// BOUNDARY:\nfunction consume(value: unknown) {}", errors: [error] },
    {
      code: "interface Callbacks {\n// Not a boundary explanation.\nreceive(value: unknown): void\n}",
      errors: [error],
    },
  ],
});
