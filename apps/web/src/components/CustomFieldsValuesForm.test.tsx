import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CustomFieldsSchema } from '@inventory-hub/shared';
import { CustomFieldsValuesForm } from './CustomFieldsValuesForm.js';

const schema: CustomFieldsSchema = [
  { key: 'serial', label: 'Sériové číslo', type: 'text', required: true },
  { key: 'color', label: 'Barva', type: 'select', required: false, options: ['černá', 'bílá'] },
];

describe('CustomFieldsValuesForm', () => {
  it('renders a field per schema entry and marks required ones', () => {
    render(<CustomFieldsValuesForm schema={schema} values={{}} onChange={() => {}} />);
    expect(screen.getByText('Sériové číslo')).toBeInTheDocument();
    expect(screen.getByText('Barva')).toBeInTheDocument();
    // Required marker.
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('shows per-field error messages', () => {
    render(
      <CustomFieldsValuesForm
        schema={schema}
        values={{}}
        onChange={() => {}}
        errors={{ serial: 'Sériové číslo je povinné' }}
      />,
    );
    expect(screen.getByText('Sériové číslo je povinné')).toBeInTheDocument();
  });

  it('emits the edited value via onChange', () => {
    const onChange = vi.fn();
    render(<CustomFieldsValuesForm schema={schema} values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'SN-42' } });
    expect(onChange).toHaveBeenCalledWith({ serial: 'SN-42' });
  });
});
