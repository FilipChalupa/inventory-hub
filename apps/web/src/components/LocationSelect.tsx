import { forwardRef, type SelectHTMLAttributes } from 'react';
import { Select } from './ui.js';
import { locationsAsTree } from '../lib/locations.js';
import type { LocationRow } from '../lib/api.js';
import { useT } from '../i18n/index.js';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  locations: LocationRow[];
  excludeId?: string;
  placeholder?: string;
};

// forwardRef so react-hook-form's `register()` ref reaches the underlying
// <select> (see Input/Select in ui.tsx for the full rationale).
export const LocationSelect = forwardRef<HTMLSelectElement, Props>(function LocationSelect(
  { locations, excludeId, placeholder, ...rest },
  ref,
) {
  const t = useT();
  const tree = locationsAsTree(locations);
  const placeholderText = placeholder ?? t.components.locationNone;
  return (
    <Select ref={ref} {...rest}>
      <option value="">{placeholderText}</option>
      {tree.map(({ row, depth }) => {
        if (row.id === excludeId) return null;
        const indent = depth === 0 ? '' : '  '.repeat(depth) + '└ ';
        return (
          <option key={row.id} value={row.id}>
            {indent}
            {row.name}
          </option>
        );
      })}
    </Select>
  );
});
