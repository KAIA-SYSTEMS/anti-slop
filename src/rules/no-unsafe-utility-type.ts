import { defineRule } from "@oxlint/plugins";

import {
	classifyUnsafeDictionaryValue,
	createTypeEnvironment,
	type TypeEnvironment,
} from "../shared/dictionary-types.ts";

const utilityTypes = new Set(["Readonly", "Partial", "Required", "Pick", "Omit"]);

export const noUnsafeUtilityTypeRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require concrete source contracts for object utility types instead of transforming unknown, any, object, or empty objects.",
		},
		messages: {
			unsafeUtility:
				"{{utility}} cannot recover a concrete contract from {{value}}. Transform the parsed owner type instead.",
		},
	},
	createOnce(context) {
		let environment: TypeEnvironment | null = null;
		return {
			Program(node) {
				environment = createTypeEnvironment(node, context.sourceCode);
			},
			TSTypeReference(node) {
				if (environment === null || node.typeName.type !== "Identifier") return;
				const name = node.typeName.name;
				if (!utilityTypes.has(name) || environment.shadowedBuiltIns.has(name)) return;
				const source = node.typeArguments?.params[0];
				if (source === undefined) return;
				const unsafe = classifyUnsafeDictionaryValue(source, environment);
				if (unsafe !== null) {
					context.report({
						node,
						messageId: "unsafeUtility",
						data: { utility: name, value: unsafe.unsafeValue },
					});
				}
			},
		};
	},
});
