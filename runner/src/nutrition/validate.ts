/**
 * Shared JSON-schema validator for nutrition VLM outputs.
 *
 * Pydantic-equivalent: the same schema is sent to Ollama via `format` (model-
 * side grammar enforcement) AND used to validate the parsed response. We
 * never trust an empty / malformed response just because the HTTP call
 * succeeded. Ajv is already a runner dep; compiled validators are cached per
 * schema-$id so repeat calls are free.
 */

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const cache = new Map<string, ValidateFunction>();

function compileSchema<T = unknown>(schema: unknown): ValidateFunction<T> {
  const id = (schema as { $id?: string }).$id ?? JSON.stringify(schema);
  const cached = cache.get(id);
  if (cached) return cached as ValidateFunction<T>;
  const v = ajv.compile<T>(schema as object);
  cache.set(id, v);
  return v;
}

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    readonly errors: unknown,
    readonly raw: string,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/**
 * Parse + validate a model response in one step. Throws
 * `SchemaValidationError` on either JSON parse failure or schema mismatch,
 * preserving the raw response for diagnostics.
 */
export function parseAndValidate<T = unknown>(raw: string, schema: unknown): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SchemaValidationError(
      `JSON parse failed: ${err instanceof Error ? err.message : err}`,
      [],
      raw,
    );
  }
  const validate = compileSchema<T>(schema);
  if (!validate(parsed)) {
    throw new SchemaValidationError(
      `schema validation failed: ${ajv.errorsText(validate.errors)}`,
      validate.errors,
      raw,
    );
  }
  return parsed as T;
}
