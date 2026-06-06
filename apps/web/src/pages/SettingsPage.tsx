import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input, Select, formatDate } from '../components/ui.js';
import type { AllowedDomain, UserRole } from '@inventory-hub/shared';

type SettingsForm = { name: string; codePrefix: string };

export function SettingsPage() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['org'], queryFn: () => apiClient.org.get() });

  const { register, handleSubmit, reset, formState } = useForm<SettingsForm>({
    defaultValues: { name: '', codePrefix: '' },
  });

  const [domains, setDomains] = useState<AllowedDomain[]>([]);

  // Populate the form ONCE from the server. A later background refetch
  // (e.g. on window focus) must not overwrite the admin's in-progress edits.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    if (org.data?.initialized && org.data.settings) {
      reset({
        name: org.data.settings.name,
        codePrefix: org.data.settings.codePrefix ?? '',
      });
      setDomains(org.data.settings.allowedDomains);
      initialized.current = true;
    }
  }, [org.data, reset]);

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
            <Field
              label="Název organizace"
              required
              error={formState.errors.name ? 'Název organizace je povinný' : undefined}
            >
              <Input {...register('name', { required: true })} />
            </Field>
            <Field
              label="Prefix kódu assetů (volitelné, např. ACME)"
              error={
                formState.errors.codePrefix
                  ? 'Prefix musí mít 2–6 znaků (A–Z, 0–9)'
                  : undefined
              }
            >
              <Input
                {...register('codePrefix', {
                  validate: (v) =>
                    !v.trim() || /^[A-Za-z0-9]{2,6}$/.test(v.trim()) || 'invalid',
                })}
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
        {save.isSuccess && !save.isPending && (
          <p className="text-sm text-emerald-600">Nastavení uloženo.</p>
        )}

        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Ukládám…' : 'Uložit nastavení'}
        </Button>
      </form>

      <InvitationsSection />

      <Card>
        <h2 className="font-semibold mb-2">Export CSV</h2>
        <p className="text-xs text-slate-500 mb-3">
          Stáhne aktuální data ve formátu CSV (UTF-8 + BOM, otevíratelné v Excelu).
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/export/assets.csv"
            className="inline-flex items-center rounded border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-sm hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-600"
          >
            Assety
          </a>
          <a
            href="/api/export/loans.csv"
            className="inline-flex items-center rounded border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-sm hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-600"
          >
            Výpůjčky
          </a>
          <a
            href="/api/export/damages.csv"
            className="inline-flex items-center rounded border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-sm hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-600"
          >
            Poškození
          </a>
          <a
            href="/api/export/contacts.csv"
            className="inline-flex items-center rounded border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-sm hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-600"
          >
            Kontakty
          </a>
        </div>
      </Card>

      <ApiKeysSection />

      <McpConnectionSection />

      {/* TODO: Dočasné – tuto sekci odebrat před finálním nasazením. */}
      <DemoDataSection />
    </section>
  );
}

function ApiKeysSection() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => apiClient.apiKeys.list() });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const create = useMutation({
    mutationFn: () => apiClient.apiKeys.create({ name: name.trim() }),
    onSuccess: (res) => {
      setCreated({ name: res.name, token: res.token });
      setName('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.apiKeys.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">API klíče</h2>
        <a href="/docs" target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
          dokumentace API →
        </a>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Pro integrace a skripty. Klíč se posílá jako{' '}
        <span className="font-mono">Authorization: Bearer …</span> a má práva admina, který ho
        vytvořil. Token uvidíš jen jednou.
      </p>

      {created && (
        <div className="mb-3 rounded border border-emerald-300 bg-emerald-50 p-3 dark:bg-emerald-950/30 dark:border-emerald-700">
          <p className="text-sm font-medium mb-1">Nový klíč „{created.name}" — zkopíruj teď:</p>
          <code className="block break-all rounded bg-white dark:bg-slate-800 p-2 font-mono text-xs">
            {created.token}
          </code>
          <Button variant="ghost" className="text-xs mt-1" onClick={() => setCreated(null)}>
            Mám zkopírováno
          </Button>
        </div>
      )}

      <form
        className="flex flex-wrap items-end gap-2 mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="flex-1 min-w-[180px]">
          <Field label="Název klíče" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="např. Zapier" />
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? 'Vytvářím…' : 'Vytvořit klíč'}
        </Button>
      </form>
      {create.error && <p className="text-sm text-red-600 mb-2">{(create.error as Error).message}</p>}

      {keys.data?.items.length === 0 ? (
        <p className="text-sm text-slate-500">Zatím žádné klíče.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {keys.data?.items.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <span className="font-medium">{k.name}</span>{' '}
                <span className="font-mono text-xs text-slate-500">{k.prefix}…</span>
                <div className="text-xs text-slate-500">
                  {k.lastUsedAt ? `naposledy ${formatDate(k.lastUsedAt)}` : 'nepoužitý'}
                  {k.expiresAt && ` · platí do ${formatDate(k.expiresAt)}`}
                </div>
              </div>
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Zrušit klíč „${k.name}"? Přestane okamžitě fungovat.`)) {
                    remove.mutate(k.id);
                  }
                }}
              >
                Zrušit
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function McpConnectionSection() {
  const info = useQuery({ queryKey: ['mcp-info'], queryFn: () => apiClient.org.mcpInfo() });
  const url = info.data?.url ?? '';
  const command = `claude mcp add --transport http inventory-hub ${url}`;
  const googleConfigured = info.data?.googleConfigured ?? false;

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Připojení AI asistenta (MCP)</h2>
        <a href="/docs" target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
          dokumentace API →
        </a>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Inventory Hub umí svá data zpřístupnit AI asistentům (Claude Desktop/Code,
        claude.ai) přes Model Context Protocol. Připojení se nastavuje v MCP klientovi,
        ne tady — níže je hotový příkaz k vložení.
      </p>

      {info.isLoading && <p className="text-sm text-slate-500">Načítám…</p>}

      {!info.isLoading && !googleConfigured && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200">
          ⚠ Přihlášení k MCP jede přes Google OAuth, který teď není nakonfigurovaný
          (<span className="font-mono">GOOGLE_CLIENT_ID</span> /{' '}
          <span className="font-mono">SECRET</span> /{' '}
          <span className="font-mono">REDIRECT_URL</span>). Konektor zatím nepůjde
          autorizovat — viz README → „Remote MCP server".
        </p>
      )}

      {!info.isLoading && (
        <div className="space-y-3">
          <CopyField label="URL konektoru" text={url} />
          <CopyField label="Příkaz pro Claude Code" text={command} />
        </div>
      )}

      <p className="text-xs text-slate-500 mt-3">
        Při prvním použití klient otevře prohlížeč k přihlášení. Pak zvolíš{' '}
        <strong>read-write</strong> (zdědí tvoji roli a oprávnění) nebo{' '}
        <strong>read-only</strong> (jen čtení). Nástroje kopírují REST API — assety,
        výpůjčky, kontakty, poškození, lokace, typy a (pro adminy) správu organizace.
      </p>
    </Card>
  );
}

function CopyField({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 break-all rounded border border-slate-200 bg-white p-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">
          {text}
        </code>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            navigator.clipboard
              ?.writeText(text)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => undefined);
          }}
        >
          {copied ? 'Zkopírováno' : 'Kopírovat'}
        </Button>
      </div>
    </div>
  );
}

// TODO: Dočasné – tato komponenta slouží pouze pro vývoj a ukázky.
// Vloží do DB sadu demo dat (typy assetů, lokace, assety, kontakt, výpůjčku
// a hlášení poškození). Smazat spolu s /api/demo routou na serveru.
function DemoDataSection() {
  const qc = useQueryClient();

  const seed = useMutation({
    mutationFn: () => apiClient.demo.seed(),
    onSuccess: () => {
      // Invalidujeme všechny cache, aby se UI okamžitě překreslilo s novými daty.
      void qc.invalidateQueries();
    },
  });

  return (
    <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700">
      <h2 className="font-semibold mb-1 text-amber-900 dark:text-amber-300">
        🧪 Demo data{' '}
        <span className="text-xs font-normal text-amber-700 dark:text-amber-400">
          (dočasné)
        </span>
      </h2>
      <p className="text-xs text-amber-800 dark:text-amber-400 mb-3">
        Vloží ukázková data do databáze: typy assetů, lokace, desítky assetů v různých stavech,
        kontakty, výpůjčky a hlášení poškození. Lze spustit opakovaně – pokaždé přidá novou sadu.
      </p>

      {seed.isSuccess && seed.data && (
        <div className="mb-3 p-2 rounded bg-emerald-50 border border-emerald-200 text-xs dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300">
          ✅ Hotovo! Vytvořeno: {seed.data.summary.assetsCreated} assetů,{' '}
          {seed.data.summary.locationsCreated} lokací,{' '}
          {seed.data.summary.loansCreated} výpůjček,{' '}
          {seed.data.summary.damageReportsCreated} hlášení poškození.
        </div>
      )}

      {seed.error && (
        <p className="text-sm text-red-600 mb-2">{(seed.error as Error).message}</p>
      )}

      <Button
        variant="secondary"
        onClick={() => seed.mutate()}
        disabled={seed.isPending}
      >
        {seed.isPending ? 'Vkládám data…' : 'Vložit demo data'}
      </Button>
    </Card>
  );
}

function InvitationsSection() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['invitations'], queryFn: () => apiClient.invitations.list() });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiClient.invitations.create({ email, role }),
    onSuccess: async (res) => {
      setEmail('');
      setLastUrl(res.acceptUrl);
      await qc.invalidateQueries({ queryKey: ['invitations'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.invitations.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });

  return (
    <Card>
      <h2 className="font-semibold mb-2">Pozvánky uživatelů</h2>
      <p className="text-xs text-slate-500 mb-3">
        Pozvaný uživatel dostane e-mail s odkazem (v dev módu se e-mail vypíše do
        konzole serveru). Pokud má SMTP nakonfigurovaný, doručí se reálně.
      </p>

      <form
        className="flex flex-wrap gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (email) create.mutate();
        }}
      >
        <div className="flex-1 min-w-[200px]">
          <Field label="E-mail" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kolega@firma.cz"
            />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="member">member</option>
              <option value="operator">operator</option>
              <option value="auditor">auditor</option>
              <option value="admin">admin</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending || !email}>
          Pozvat
        </Button>
      </form>

      {create.error && (
        <p className="text-sm text-red-600 mt-2">{(create.error as Error).message}</p>
      )}

      {lastUrl && (
        <div className="mt-3 p-3 rounded bg-emerald-50 border border-emerald-200 text-xs space-y-1">
          <p className="font-medium">Pozvánka vytvořena. Odkaz:</p>
          <code className="block break-all">{lastUrl}</code>
          <Button
            variant="secondary"
            className="text-xs"
            onClick={() => navigator.clipboard.writeText(lastUrl)}
          >
            Kopírovat
          </Button>
        </div>
      )}

      <ul className="divide-y border rounded mt-4">
        {list.data?.items.length === 0 && (
          <li className="p-3 text-sm text-slate-500">Žádné čekající pozvánky.</li>
        )}
        {list.data?.items.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between p-3 gap-2">
            <div>
              <p className="text-sm font-medium">{inv.email}</p>
              <p className="text-xs text-slate-500">
                role {inv.role} · platí do {formatDate(inv.expiresAt)}
              </p>
            </div>
            <Button
              variant="ghost"
              className="text-red-600 text-xs"
              onClick={() => remove.mutate(inv.id)}
            >
              Zrušit
            </Button>
          </li>
        ))}
      </ul>
    </Card>
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

  const add = () => {
    if (!domain) return;
    if (value.some((d) => d.domain === domain)) return;
    onChange([...value, { domain, defaultRole: role }]);
    setDomain('');
  };

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
              onKeyDown={(e) => {
                // Enter here should add the domain, not submit the whole
                // settings form (this editor lives inside that form).
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
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
        <Button type="button" variant="secondary" onClick={add}>
          Přidat
        </Button>
      </div>
    </div>
  );
}
