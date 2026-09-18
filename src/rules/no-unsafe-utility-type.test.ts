import { RuleTester } from "oxlint/plugins-dev";

import { noUnsafeUtilityTypeRule } from "./no-unsafe-utility-type.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unsafeUtility" };

tester.run("anti-slop/no-unsafe-utility-type", noUnsafeUtilityTypeRule, {
	valid: [
		"type Values = Partial<Owner>;",
		"type Values = Readonly<{ payload: unknown }>;",
		"type Values = Required<{ id?: string }>;",
		"type Values = Pick<Owner, 'id'>;",
		"type Values = Omit<Owner, 'id'>;",
		"type Values = Partial<Map<string, Owner>>;",
		"type Values<Value> = Partial<Value>;",
		"type Values = Readonly<string>;",
		"type Values = NonNullable<unknown>;",
		"interface Object { id: string } type Values = Partial<Object>;",
		"interface Owner { id: string } type Values = Partial<unknown & Owner>;",
		"type Partial<Value> = { value: Value }; type Values = Partial<unknown>;",
		"import { Partial } from './owner'; type Values = Partial<unknown>;",
		"type Readonly<Value> = { value: Value }; type Values = Readonly<unknown>;",
		"type Values = Record<string, unknown>;",
	],
	invalid: [
		{ code: "type Values = Partial<unknown>;", errors: [error] },
		{ code: "type Values = Required<unknown>;", errors: [error] },
		{ code: "type Values = Readonly<unknown>;", errors: [error] },
		{ code: "type Values = Omit<unknown, never>;", errors: [error] },
		{ code: "type Values = Pick<unknown, string>;", errors: [error] },
		{ code: "type Values = Partial<any>;", errors: [error] },
		{ code: "type Values = Partial<object>;", errors: [error] },
		{ code: "type Values = Partial<Object>;", errors: [error] },
		{ code: "type Values = Partial<{}>;", errors: [error] },
		{ code: "type Payload = unknown; type Values = Partial<Payload>;", errors: [error] },
		{ code: "type Identity<Value> = Value; type Values = Partial<Identity<unknown>>;", errors: [error] },
		{ code: "interface Empty {} type Values = Readonly<Empty>;", errors: [error] },
		{ code: "type Values = Readonly<Owner | unknown>;", errors: [error] },
		{ code: "type Values = Readonly<Partial<unknown>>;", errors: 2 },
	],
});
