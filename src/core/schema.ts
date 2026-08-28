/**
 * JSON Schema is the authoritative contract. This module loads the schema
 * files shipped under schemas/ and validates documents, translating ajv
 * failures into stable SCH_* error codes with the first failing path.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type ErrorObject, type JSONSchemaType } from "ajv";

const thisDir = dirname(fileURLToPath(import.meta.url));
// schemas/ lives at the package root, two levels above src/core.
const packageRoot = join(thisDir, "..", "..");

export type SchemaName =
  | "user-config"
  | "source-manifest"
  | "root-index"
  | "approximation-overlay"
  | "ir";

const SCHEMA_FILES: Record<SchemaName, string> = {
  "user-config": "user-config.schema.json",
  "source-manifest": "source-manifest.schema.json",
  "root-index": "root-index.schema.json",
  "approximation-overlay": "approximation-overlay.schema.json",
  ir: "ir.schema.json",
};

export interface SchemaValidationResult {
  valid: boolean;
  /** First failing JSON path, e.g. "roots/0/prefabName". */
  path?: string;
  keyword?: string;
  message?: string;
  details?: string;
}

function resolveSchemaDir(): string {
  // Allow tests / consumers to point at an explicit schema directory.
  const explicit = process.env.FIGMA_TO_UPREFAB_SCHEMAS;
  if (explicit) {
    return explicit;
  }

  // Walk up from the module location until a schemas/ directory with our
  // schemas is found. Works both from src (dev/tests) and dist (built pkg).
  let dir = thisDir;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, "schemas");
    try {
      if (existsSync(join(candidate, SCHEMA_FILES["user-config"]!))) {
        return candidate;
      }
    } catch {
      /* keep walking */
    }
    dir = join(dir, "..");
  }

  return join(packageRoot, "schemas");
}

let ajvInstance: Ajv | null = null;
const schemaCache = new Map<SchemaName, JSONSchemaType<unknown>>();

function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ allErrors: false, strict: false });
  }

  return ajvInstance;
}

function loadSchema(name: SchemaName): JSONSchemaType<unknown> {
  const cached = schemaCache.get(name);
  if (cached) {
    return cached;
  }

  const file = join(resolveSchemaDir(), SCHEMA_FILES[name]!);
  const raw = JSON.parse(readFileSync(file, "utf8")) as JSONSchemaType<unknown>;
  schemaCache.set(name, raw);
  return raw;
}

function firstErrorPath(error: ErrorObject): string {
  return error.instancePath ? error.instancePath.replace(/^\//, "") : "(root)";
}

export function validateSchema(name: SchemaName, document: unknown): SchemaValidationResult {
  const schema = loadSchema(name);
  const validate = getAjv().compile(schema);
  const ok = validate(document);
  if (ok) {
    return { valid: true };
  }

  const first = (validate.errors ?? [])[0];
  if (!first) {
    return { valid: false, message: "unknown validation error" };
  }

  return {
    valid: false,
    path: firstErrorPath(first),
    keyword: first.keyword,
    message: first.message,
    details: `${first.instancePath || "/"} ${first.message ?? ""}`.trim(),
  };
}

