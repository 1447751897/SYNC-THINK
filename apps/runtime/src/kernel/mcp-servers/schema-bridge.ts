/**
 * JSON Schema → real zod shape bridge.
 *
 * The SDK's `createSdkMcpServer` validates tool inputs at call time through
 * `validateToolInput` → `zl(inputSchema)`:
 *
 *   - raw shapes whose property values only carry a fake `parse`/`safeParse`
 *     marker are routed to the "external zod version" adapter, which then
 *     parses arguments through `safeParseAsync`; a fake object lacks the full
 *     zod protocol and blows up with `l._parse is not a function` (the exact
 *     failure observed on claude-code when the model called
 *     `mcp__platform__ask_user_question`).
 *   - a real zod schema (any version the SDK can introspect) parses arguments
 *     correctly and enforces types/required fields.
 *
 * So the bridge converts our JSON-Schema `ProviderToolSchema` source of truth
 * into a real zod raw shape, using a zod instance injected by the caller
 * (the runtime already depends on the workspace zod through
 * `@sync-think/protocol`). The host executors keep consuming the plain JSON
 * schema — the zod shape is only the SDK-facing validation contract.
 */
import type { ZodNumber, ZodRawShape, ZodString, ZodTypeAny } from 'zod';

export type ZodFactory = typeof import('zod').z;

/** JSON-Schema node subset the SDK tool inputs actually use. */
type JsonSchemaNode = {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  [key: string]: unknown;
};

function buildZodNode(z: ZodFactory, schema: JsonSchemaNode): ZodTypeAny {
  const type = typeof schema.type === 'string' ? schema.type : 'string';
  switch (type) {
    case 'array': {
      const items = schema.items;
      const inner = items ? buildZodNode(z, items) : z.any();
      return z.array(inner);
    }
    case 'object': {
      const shape: ZodRawShape = {};
      if (schema.properties && typeof schema.properties === 'object') {
        for (const [key, rawValue] of Object.entries(schema.properties)) {
          const node = rawValue && typeof rawValue === 'object' ? (rawValue as JsonSchemaNode) : {};
          const inner = buildZodNode(z, node);
          const withDesc =
            typeof node.description === 'string' ? inner.describe(node.description) : inner;
          if (Array.isArray(schema.required) && schema.required.includes(key)) {
            shape[key] = withDesc;
          } else {
            shape[key] = withDesc.optional();
          }
        }
      }
      return z.object(shape);
    }
    case 'integer': {
      let node: ZodNumber = z.number().int();
      if (typeof schema.minimum === 'number') node = node.min(schema.minimum);
      if (typeof schema.maximum === 'number') node = node.max(schema.maximum);
      return node;
    }
    case 'number': {
      let node: ZodNumber = z.number();
      if (typeof schema.minimum === 'number') node = node.min(schema.minimum);
      if (typeof schema.maximum === 'number') node = node.max(schema.maximum);
      return node;
    }
    case 'boolean':
      return z.boolean();
    default: {
      let node: ZodString = z.string();
      if (typeof schema.minLength === 'number') node = node.min(schema.minLength);
      if (typeof schema.maxLength === 'number') node = node.max(schema.maxLength);
      if (Array.isArray(schema.enum)) {
        const values = schema.enum.map((value) => String(value));
        return z.enum(values as [string, ...string[]]);
      }
      return node;
    }
  }
}

/**
 * Convert a JSON-Schema `inputSchema` (object shape) into a real zod raw
 * shape, ready for `createSdkMcpServer` tool definitions. Every top-level
 * property becomes a real zod schema; `required` rides as optional-omit.
 */
export function jsonSchemaToZodShape(
  z: ZodFactory,
  inputSchema: Record<string, unknown>,
): ZodRawShape {
  const properties = inputSchema.properties as Record<string, JsonSchemaNode> | undefined;
  const requiredList = Array.isArray(inputSchema.required)
    ? (inputSchema.required as unknown[])
    : [];
  const requiredSet = new Set(requiredList.map((value) => String(value)));
  const shape: ZodRawShape = {};
  if (!properties || typeof properties !== 'object') return shape;
  for (const [key, rawValue] of Object.entries(properties)) {
    const node = rawValue && typeof rawValue === 'object' ? (rawValue as JsonSchemaNode) : {};
    const inner = buildZodNode(z, node);
    shape[key] = requiredSet.has(key) ? inner : inner.optional();
  }
  return shape;
}
