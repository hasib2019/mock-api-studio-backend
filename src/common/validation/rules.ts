/**
 * The rule catalog.
 *
 * One source of truth shared by:
 *  - the validation engine (`./engine.ts`) - how a rule behaves
 *  - the endpoint builder UI - which rules can be added to which field type,
 *    what argument the rule takes and how to label it
 *  - the OpenAPI / docs exporter
 */

import type { FieldType, RuleId } from "../types";

export type RuleArgType =
  | "none"
  | "number"
  | "integer"
  | "text"
  | "regex"
  | "list"
  | "field"
  | "date"
  | "textPair";

export type RuleGroup =
  | "presence"
  | "string"
  | "number"
  | "choice"
  | "date"
  | "array"
  | "cross-field"
  | "custom";

export interface RuleMeta {
  id: RuleId;
  label: string;
  group: RuleGroup;
  /** field types the rule may be attached to */
  appliesTo: FieldType[];
  argType: RuleArgType;
  argLabel?: string;
  arg2Label?: string;
  argPlaceholder?: string;
  /** default message; {field} {value} {arg} {arg2} are interpolated */
  defaultMessage: string;
  hint?: string;
}

const STRINGY: FieldType[] = ["string"];
const NUMERIC: FieldType[] = ["number", "integer"];
const ANY_SCALAR: FieldType[] = ["string", "number", "integer", "boolean", "any"];
const ALL: FieldType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "any",
];

export const RULE_CATALOG: RuleMeta[] = [
  /* ----------------------------- presence ----------------------------- */
  {
    id: "requiredIf",
    label: "Required if",
    group: "presence",
    appliesTo: ALL,
    argType: "textPair",
    argLabel: "Other field",
    arg2Label: "equals value",
    argPlaceholder: "paymentMode",
    defaultMessage: "{field} is required when {arg} is {arg2}",
    hint: "Conditional requirement, e.g. routingNumber required when bank is OTHER.",
  },
  {
    id: "requiredUnless",
    label: "Required unless",
    group: "presence",
    appliesTo: ALL,
    argType: "textPair",
    argLabel: "Other field",
    arg2Label: "equals value",
    argPlaceholder: "channel",
    defaultMessage: "{field} is required unless {arg} is {arg2}",
  },

  /* ------------------------------ string ------------------------------ */
  {
    id: "minLength",
    label: "Min length",
    group: "string",
    appliesTo: STRINGY,
    argType: "integer",
    argLabel: "Characters",
    argPlaceholder: "3",
    defaultMessage: "{field} must be at least {arg} characters",
  },
  {
    id: "maxLength",
    label: "Max length",
    group: "string",
    appliesTo: STRINGY,
    argType: "integer",
    argLabel: "Characters",
    argPlaceholder: "50",
    defaultMessage: "{field} must be at most {arg} characters",
  },
  {
    id: "exactLength",
    label: "Exact length",
    group: "string",
    appliesTo: STRINGY,
    argType: "integer",
    argLabel: "Characters",
    argPlaceholder: "13",
    defaultMessage: "{field} must be exactly {arg} characters",
    hint: "Handy for NID (10/13/17), account numbers, SWIFT codes.",
  },
  {
    id: "pattern",
    label: "Regex pattern",
    group: "string",
    appliesTo: STRINGY,
    argType: "regex",
    argLabel: "Pattern",
    argPlaceholder: "^01[3-9]\\d{8}$",
    defaultMessage: "{field} format is invalid",
    hint: "e.g. ^01[3-9]\\d{8}$ for a Bangladeshi mobile number.",
  },
  {
    id: "email",
    label: "Email",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} must be a valid email address",
  },
  {
    id: "url",
    label: "URL",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} must be a valid URL",
  },
  {
    id: "uuid",
    label: "UUID",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} must be a valid UUID",
  },
  {
    id: "alpha",
    label: "Letters only",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} may contain letters only",
  },
  {
    id: "alphanumeric",
    label: "Letters + digits only",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} may contain letters and digits only",
  },
  {
    id: "numericString",
    label: "Digits only",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} may contain digits only",
  },
  {
    id: "startsWith",
    label: "Starts with",
    group: "string",
    appliesTo: STRINGY,
    argType: "text",
    argLabel: "Prefix",
    argPlaceholder: "BD",
    defaultMessage: "{field} must start with {arg}",
  },
  {
    id: "endsWith",
    label: "Ends with",
    group: "string",
    appliesTo: STRINGY,
    argType: "text",
    argLabel: "Suffix",
    defaultMessage: "{field} must end with {arg}",
  },
  {
    id: "noWhitespace",
    label: "No whitespace",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} must not contain whitespace",
  },
  {
    id: "lowercase",
    label: "Lowercase only",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} must be lowercase",
  },
  {
    id: "uppercase",
    label: "Uppercase only",
    group: "string",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} must be uppercase",
  },

  /* ------------------------------ number ------------------------------ */
  {
    id: "min",
    label: "Minimum (>=)",
    group: "number",
    appliesTo: NUMERIC,
    argType: "number",
    argLabel: "Value",
    argPlaceholder: "1",
    defaultMessage: "{field} must be greater than or equal to {arg}",
  },
  {
    id: "max",
    label: "Maximum (<=)",
    group: "number",
    appliesTo: NUMERIC,
    argType: "number",
    argLabel: "Value",
    argPlaceholder: "500000",
    defaultMessage: "{field} must be less than or equal to {arg}",
  },
  {
    id: "greaterThan",
    label: "Greater than (>)",
    group: "number",
    appliesTo: NUMERIC,
    argType: "number",
    argLabel: "Value",
    defaultMessage: "{field} must be greater than {arg}",
  },
  {
    id: "lessThan",
    label: "Less than (<)",
    group: "number",
    appliesTo: NUMERIC,
    argType: "number",
    argLabel: "Value",
    defaultMessage: "{field} must be less than {arg}",
  },
  {
    id: "positive",
    label: "Positive",
    group: "number",
    appliesTo: NUMERIC,
    argType: "none",
    defaultMessage: "{field} must be a positive number",
  },
  {
    id: "negative",
    label: "Negative",
    group: "number",
    appliesTo: NUMERIC,
    argType: "none",
    defaultMessage: "{field} must be a negative number",
  },
  {
    id: "multipleOf",
    label: "Multiple of",
    group: "number",
    appliesTo: NUMERIC,
    argType: "number",
    argLabel: "Step",
    argPlaceholder: "100",
    defaultMessage: "{field} must be a multiple of {arg}",
  },
  {
    id: "maxDecimals",
    label: "Max decimal places",
    group: "number",
    appliesTo: NUMERIC,
    argType: "integer",
    argLabel: "Places",
    argPlaceholder: "2",
    defaultMessage: "{field} may have at most {arg} decimal places",
    hint: "Money fields normally allow 2.",
  },

  /* ------------------------------ choice ------------------------------ */
  {
    id: "enum",
    label: "One of",
    group: "choice",
    appliesTo: ANY_SCALAR,
    argType: "list",
    argLabel: "Allowed values",
    argPlaceholder: "SAVINGS, CURRENT, SND",
    defaultMessage: "{field} must be one of: {arg}",
  },
  {
    id: "notIn",
    label: "Not one of",
    group: "choice",
    appliesTo: ANY_SCALAR,
    argType: "list",
    argLabel: "Blocked values",
    defaultMessage: "{field} must not be one of: {arg}",
  },

  /* ------------------------------- date ------------------------------- */
  {
    id: "date",
    label: "Valid date",
    group: "date",
    appliesTo: STRINGY,
    argType: "none",
    defaultMessage: "{field} must be a valid date",
  },
  {
    id: "dateFormat",
    label: "Date format",
    group: "date",
    appliesTo: STRINGY,
    argType: "text",
    argLabel: "Format",
    argPlaceholder: "YYYY-MM-DD",
    defaultMessage: "{field} must match the format {arg}",
    hint: "Supports YYYY, MM, DD, HH, mm, ss.",
  },
  {
    id: "before",
    label: "Before date",
    group: "date",
    appliesTo: STRINGY,
    argType: "date",
    argLabel: "Date or `today`",
    argPlaceholder: "today",
    defaultMessage: "{field} must be before {arg}",
  },
  {
    id: "after",
    label: "After date",
    group: "date",
    appliesTo: STRINGY,
    argType: "date",
    argLabel: "Date or `today`",
    argPlaceholder: "today",
    defaultMessage: "{field} must be after {arg}",
  },
  {
    id: "minAge",
    label: "Minimum age (years)",
    group: "date",
    appliesTo: STRINGY,
    argType: "integer",
    argLabel: "Years",
    argPlaceholder: "18",
    defaultMessage: "{field} means the person must be at least {arg} years old",
    hint: "Reads the field as a date of birth.",
  },

  /* ------------------------------- array ------------------------------ */
  {
    id: "minItems",
    label: "Min items",
    group: "array",
    appliesTo: ["array"],
    argType: "integer",
    argLabel: "Items",
    argPlaceholder: "1",
    defaultMessage: "{field} must contain at least {arg} item(s)",
  },
  {
    id: "maxItems",
    label: "Max items",
    group: "array",
    appliesTo: ["array"],
    argType: "integer",
    argLabel: "Items",
    argPlaceholder: "10",
    defaultMessage: "{field} must contain at most {arg} item(s)",
  },
  {
    id: "uniqueItems",
    label: "Unique items",
    group: "array",
    appliesTo: ["array"],
    argType: "none",
    defaultMessage: "{field} must not contain duplicate values",
  },

  /* ---------------------------- cross-field --------------------------- */
  {
    id: "equalsField",
    label: "Equals another field",
    group: "cross-field",
    appliesTo: ANY_SCALAR,
    argType: "field",
    argLabel: "Other field",
    argPlaceholder: "confirmAccountNumber",
    defaultMessage: "{field} must match {arg}",
  },
  {
    id: "notEqualsField",
    label: "Differs from another field",
    group: "cross-field",
    appliesTo: ANY_SCALAR,
    argType: "field",
    argLabel: "Other field",
    argPlaceholder: "fromAccount",
    defaultMessage: "{field} must be different from {arg}",
    hint: "e.g. toAccount must differ from fromAccount.",
  },
  {
    id: "gtField",
    label: "Greater than another field",
    group: "cross-field",
    appliesTo: NUMERIC,
    argType: "field",
    argLabel: "Other field",
    defaultMessage: "{field} must be greater than {arg}",
  },
  {
    id: "ltField",
    label: "Less than another field",
    group: "cross-field",
    appliesTo: NUMERIC,
    argType: "field",
    argLabel: "Other field",
    defaultMessage: "{field} must be less than {arg}",
  },

  /* ------------------------------ custom ------------------------------ */
  {
    id: "custom",
    label: "Custom expression",
    group: "custom",
    appliesTo: ALL,
    argType: "text",
    argLabel: "Expression",
    argPlaceholder: "value.length === 13 || value.length === 17",
    defaultMessage: "{field} failed the custom check",
    hint: "A safe JS boolean expression. Available: value, body, query, headers.",
  },
];

export const RULE_BY_ID: Record<string, RuleMeta> = Object.fromEntries(
  RULE_CATALOG.map((r) => [r.id, r]),
);

export const RULE_GROUP_LABELS: Record<RuleGroup, string> = {
  presence: "Presence",
  string: "Text",
  number: "Number",
  choice: "Choice",
  date: "Date & time",
  array: "Array",
  "cross-field": "Cross-field",
  custom: "Custom",
};

/** Rules that can be attached to a field of the given type. */
export function rulesForType(type: FieldType): RuleMeta[] {
  return RULE_CATALOG.filter((r) => r.appliesTo.includes(type));
}

/** Fill {field} {value} {arg} {arg2} placeholders in a message. */
export function formatMessage(
  template: string,
  vars: { field: string; value?: unknown; arg?: unknown; arg2?: unknown },
): string {
  const render = (v: unknown): string => {
    if (v === undefined || v === null) return "";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return template
    .replace(/\{field\}/g, vars.field)
    .replace(/\{value\}/g, render(vars.value))
    .replace(/\{arg2\}/g, render(vars.arg2))
    .replace(/\{arg\}/g, render(vars.arg));
}
