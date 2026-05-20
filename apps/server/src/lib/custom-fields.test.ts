import { describe, it, expect } from 'vitest';
import { validateCustomFieldValues, type CustomFieldsSchema } from '@inventory-hub/shared';

describe('validateCustomFieldValues', () => {
  const schema: CustomFieldsSchema = [
    { key: 'serial_number', label: 'Sériové číslo', type: 'text', required: true },
    { key: 'purchase_price', label: 'Cena', type: 'number', required: false },
    { key: 'has_warranty', label: 'Záruka', type: 'boolean', required: false },
    {
      key: 'condition',
      label: 'Stav',
      type: 'select',
      required: false,
      options: ['nový', 'použitý', 'rozbalený'],
    },
  ];

  it('passes when all required fields are present and types match', () => {
    const result = validateCustomFieldValues(schema, {
      serial_number: 'ABC-123',
      purchase_price: '14990',
      has_warranty: true,
      condition: 'nový',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values).toEqual({
        serial_number: 'ABC-123',
        purchase_price: 14990,
        has_warranty: true,
        condition: 'nový',
      });
    }
  });

  it('reports missing required field', () => {
    const result = validateCustomFieldValues(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.serial_number).toMatch(/povinné/);
  });

  it('rejects non-numeric for number field', () => {
    const result = validateCustomFieldValues(schema, {
      serial_number: 'X',
      purchase_price: 'not-a-number',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.purchase_price).toMatch(/číslo/);
  });

  it('rejects select value outside options', () => {
    const result = validateCustomFieldValues(schema, {
      serial_number: 'X',
      condition: 'rozbitý',
    });
    expect(result.ok).toBe(false);
  });

  it('ignores empty optional fields', () => {
    const result = validateCustomFieldValues(schema, {
      serial_number: 'X',
      purchase_price: '',
      condition: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values).toEqual({ serial_number: 'X' });
    }
  });
});
