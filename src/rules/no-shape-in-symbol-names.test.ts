import { RuleTester } from "oxlint/plugins-dev";

import { noForbiddenTermInSymbolNamesRule } from "./no-shape-in-symbol-names.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "forbiddenSymbolName" };

tester.run("anti-slop/no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
  valid: [
    "const status = schema.shape.status",
    "const { shape: contract } = schema",
    "interface UserContract { readonly id: string }",
    "import { ExternalShape as ExternalContract } from './external'",
  ],
  invalid: [
    { code: "interface UserShape { readonly id: string }", errors: [error] },
    { code: "const responseShape = {}", errors: [error] },
    { code: "function parseShape(value: string) {}", errors: [error] },
    { code: "import { ExternalShape } from './external'", errors: [error] },
    { code: "interface Contract { readonly payloadShape: string }", errors: [error] },
  ],
});
