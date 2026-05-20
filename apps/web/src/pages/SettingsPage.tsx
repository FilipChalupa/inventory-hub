import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input, Select } from '../components/ui.js';
import type { AllowedDomain, UserRole } from '@inventory-hub/shared';

type SettingsForm = { name: string; codePrefix: string };

export function SettingsPage() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['org'], queryFn: () => apiClient.org.get() });

  const { register, handleSubmit, reset } = useForm<SettingsForm>({
    defaultValues: { name: '', codePrefix: '' },
  });

  useEffect(() => {
    if (org.data?.initialized && org.data.settings) {
      reset({
        name: org.data.settings.name,
        codePrefix: org.data.settings.codePrefix ?? '',
      });
    }
  }, [org.data, reset]);

  const [domains, setDomains] = useState<AllowedDomain[]>([]);
  useEffect(() => {
    if (org.data?.initialized && org.data.settings) {
      setDomains(org.data.settings.allowedDomains);
    }
  }, [org.data]);

  const save = useMutation({
    mutationFn: (values: SettingsForm) =>
      apiClient.org.put({
        name: values.name,
        codePrefix: values.codePrefix.trim() ? values.codePrefix.trim().toUpperCase() : null,
        allowedDomains: domains,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org'] }),
  });

  return (
    <section className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Nastavení organizace</h1>

      <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <Card>
          <div className="space-y-3">
            <Field label="Název organizace">
              <Input {...register('name', { required: true })} />
            </Field>
            <Field label="Prefix kódu assetů (volitelné, např. ACME)">
              <Input
                {...register('codePrefix')}
                placeholder="ACME"
                className="font-mono w-32"
                maxLength={6}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold mb-2">Povolené domény (Google auto-join)</h2>
          <p className="text-xs text-slate-500 mb-3">
            Exact match — <span className="font-mono">acme.com</span> NEPOKRYJE{' '}
            <span className="font-mono">eng.acme.com</span>. Subdomény přidávej zvlášť.
          </p>
          <AllowedDomainsEditor value={domains} onChange={setDomains} />
        </Card>

        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}

        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Ukládám…' : 'Uložit nastavení'}
        </Button>
      </form>
    </section>
  );
}

function AllowedDomainsEditor({
  value,
  onChange,
}: {
  value: AllowedDomain[];
  onChange: (v: AllowedDomain[]) => void;
}) {
  const [domain, setDomain] = useState('');
  const [role, setRole] = useState<UserRole>('member');

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded border">
        {value.length === 0 && (
          <li className="p-3 text-sm text-slate-500">Žádné domény nejsou povoleny.</li>
        )}
        {value.map((d) => (
          <li key={d.domain} className="flex items-center justify-between p-2 gap-2">
            <span className="font-mono text-sm">{d.domain}</span>
            <span className="text-xs text-slate-500">→ {d.defaultRole}</span>
            <Button
              variant="ghost"
              className="text-red-600 text-xs"
              onClick={() => onChange(value.filter((x) => x.domain !== d.domain))}
            >
              Odebrat
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Field label="Doména">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value.toLowerCase())}
              placeholder="acme.com"
              className="font-mono"
            />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Default role">
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="member">member</option>
              <option value="operator">operator</option>
              <option value="auditor">auditor</option>
              <option value="admin">admin</option>
            </Select>
          </Field>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (!domain) return;
            if (value.some((d) => d.domain === domain)) return;
            onChange([...value, { domain, defaultRole: role }]);
            setDomain('');
          }}
        >
          Přidat
        </Button>
      </div>
    </div>
  );
}
