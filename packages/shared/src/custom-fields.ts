import { z } from 'zod';

export const customFieldTypes = ['text', 'number', 'date', 'boolean', 'select'] as const;
export type CustomFieldType = (typeof customFieldTypes)[number];

const fieldKey = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/, 'Klíč: malé písmeno na začátku, jen a–z, 0–9, _');

export const customFieldDefSchema = z.object({
  key: fieldKey,
  label: z.string().min(1).max(100),
  type: z.enum(customFieldTypes),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(100)).optional(),
});
export type CustomFieldDef = z.infer<typeof customFieldDefSchema>;

export const customFieldsSchemaSchema = z.array(customFieldDefSchema).default([]);
export type CustomFieldsSchema = z.infer<typeof customFieldsSchemaSchema>;

/**
 * Validates a record of custom field values against a schema.
 * Coerces empty strings to undefined for non-required fields.
 * Returns parsed values keyed by field key (only for keys present in schema).
 */
export function validateCustomFieldValues(
  schema: CustomFieldsSchema,
  values: Record<string, unknown>,
): { ok: true; values: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const result: Record<string, unknown> = {};

  for (const def of schema) {
    const raw = values[def.key];
    const isEmpty = raw === undefined || raw === null || raw === '';
    if (isEmpty) {
      if (def.required) errors[def.key] = `${def.label} je povinné`;
      continue;
    }
    switch (def.type) {
      case 'text':
        if (typeof raw !== 'string') errors[def.key] = 'Očekáván text';
        else result[def.key] = raw;
        break;
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isNaN(n)) errors[def.key] = 'Očekáváno číslo';
        else result[def.key] = n;
        break;
      }
      case 'date': {
        const d = raw instanceof Date ? raw : new Date(String(raw));
        if (Number.isNaN(d.getTime())) errors[def.key] = 'Neplatné datum';
        else result[def.key] = d.toISOString();
        break;
      }
      case 'boolean':
        result[def.key] = Boolean(raw);
        break;
      case 'select':
        if (typeof raw !== 'string' || !def.options?.includes(raw)) {
          errors[def.key] = 'Hodnota není v seznamu možností';
        } else {
          result[def.key] = raw;
        }
        break;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: result };
}
