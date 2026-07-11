import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input, Select, formatDate } from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { useT } from '../i18n/index.js';
import { hasRole, useCurrentUser } from '../auth/AuthContext.js';
import type { AllowedDomain, UserRole } from '@inventory-hub/shared';

const SELF_HOSTING_DOCS_URL =
  'https://github.com/FilipChalupa/inventory-hub/blob/main/docs/SELF_HOSTING.md#backups';

type SettingsForm = {
  name: string;
  codePrefix: string;
  publicLookupEnabled: boolean;
  webhookUrl: string;
  // Write-only: never populated from the server (GET returns null). Sent only
  // when the admin types a new value; empty means "keep the existing secret".
  webhookSecret: string;
};

export function SettingsPage() {
  const t = useT();
  const qc = useQueryClient();
  const isAdmin = hasRole(useCurrentUser(), 'admin');
  const org = useQuery({ queryKey: ['org'], queryFn: () => apiClient.org.get() });
  const webhookSecretSet = org.data?.settings?.webhookSecretSet ?? false;

  const { register, handleSubmit, reset, watch, formState } = useForm<SettingsForm>({
    defaultValues: {
      name: '',
      codePrefix: '',
      publicLookupEnabled: false,
      webhookUrl: '',
      webhookSecret: '',
    },
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
        publicLookupEnabled: org.data.settings.publicLookupEnabled,
        webhookUrl: org.data.settings.webhookUrl ?? '',
        webhookSecret: '',
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
        // Round-trip the integration settings too, otherwise the backend
        // defaults (false/null) would overwrite them on every save.
        publicLookupEnabled: values.publicLookupEnabled,
        webhookUrl: values.webhookUrl.trim() ? values.webhookUrl.trim() : null,
        webhookSecret: values.webhookSecret.trim() ? values.webhookSecret.trim() : null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org'] }),
  });

  return (
    <section className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">{t.settings.title}</h1>

      <BackupWarning backupsConfigured={org.data?.backupsConfigured} />

      <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <Card>
          <div className="space-y-3">
            <Field
              label={t.settings.orgNameLabel}
              required
              error={formState.errors.name ? t.settings.orgNameRequired : undefined}
            >
              <Input {...register('name', { required: true })} />
            </Field>
            <Field
              label={t.settings.codePrefixLabel}
              error={formState.errors.codePrefix ? t.settings.codePrefixError : undefined}
            >
              <Input
                {...register('codePrefix', {
                  validate: (v) => !v.trim() || /^[A-Za-z0-9]{2,6}$/.test(v.trim()) || 'invalid',
                })}
                placeholder="ACME"
                className="font-mono w-32"
                maxLength={6}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold mb-2">{t.settings.allowedDomainsTitle}</h2>
          <p className="text-xs text-slate-500 mb-3">
            {t.settings.allowedDomainsExactNote1}
            <span className="font-mono">acme.com</span>
            {t.settings.allowedDomainsExactNote2}
            <span className="font-mono">eng.acme.com</span>
            {t.settings.allowedDomainsExactNote3}
          </p>
          <AllowedDomainsEditor value={domains} onChange={setDomains} />
        </Card>

        {isAdmin && (
          <Card>
            <h2 className="font-semibold mb-2">{t.settings.integrationsTitle}</h2>

            <div className="space-y-4">
              <div>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" {...register('publicLookupEnabled')} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {t.settings.publicLookupLabel}
                  </span>
                </label>
                {watch('publicLookupEnabled') && (
                  <p className="mt-1 ml-6 text-xs text-slate-500">
                    {t.settings.publicLookupHint1}
                    <span className="font-mono">/p/&lt;code&gt;</span>
                    {t.settings.publicLookupHint2}
                  </p>
                )}
              </div>

              <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
                <Field label={t.settings.webhookUrlLabel}>
                  <Input
                    type="url"
                    {...register('webhookUrl')}
                    placeholder="https://example.com/webhooks/inventory"
                  />
                </Field>
                <Field label={t.settings.webhookSecretLabel}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    {...register('webhookSecret')}
                    placeholder={
                      webhookSecretSet
                        ? t.settings.webhookSecretSetPlaceholder
                        : t.settings.webhookSecretPlaceholder
                    }
                  />
                </Field>
                <p className="text-xs text-slate-500">
                  {t.settings.webhookHint1}
                  <span className="font-mono">loan.overdue</span>,{' '}
                  <span className="font-mono">damage.reported</span>,{' '}
                  <span className="font-mono">asset.archived</span>
                  {t.settings.webhookHint2}
                  <span className="font-mono">x-inventory-signature</span>
                  {t.settings.webhookHint3}
                </p>
              </div>
            </div>
          </Card>
        )}

        {save.error && <p className="text-sm text-red-600">{errorMessage(save.error)}</p>}
        {save.isSuccess && !save.isPending && (
          <p className="text-sm text-emerald-600">{t.settings.settingsSaved}</p>
        )}

        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t.common.saving : t.settings.saveSettings}
        </Button>
      </form>

      <InvitationsSection />

      <Card>
        <h2 className="font-semibold mb-2">{t.settings.exportTitle}</h2>
        <p className="text-xs text-slate-500 mb-3">{t.settings.exportNote}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/export/assets.csv"
            className="inline-flex items-center rounded border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-sm hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-600"
          >
            {t.settings.exportAssets}
          </a>
          <a
            href="/api/export/loans.csv"
            className="inline-flex items-center rounded border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-sm hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-600"
          >
            {t.settings.exportLoans}
          </a>
          <a
            href="/api/export/damages.csv"
            className="inline-flex items-center rounded border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-sm hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-600"
          >
            {t.settings.exportDamages}
          </a>
          <a
            href="/api/export/contacts.csv"
            className="inline-flex items-center rounded border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-sm hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-600"
          >
            {t.settings.exportContacts}
          </a>
        </div>
      </Card>

      <CalendarFeedSection />

      <ApiKeysSection />

      <McpConnectionSection />
    </section>
  );
}

/**
 * Admin-only nudge shown when the server reports no configured backups
 * (`BACKUPS_CONFIGURED` env unset). Losing the SQLite file is the single
 * biggest data-loss risk, so we surface it here rather than in the app shell.
 * Hidden while the flag is still unknown (undefined) to avoid a flash.
 */
function BackupWarning({ backupsConfigured }: { backupsConfigured: boolean | undefined }) {
  const t = useT();
  const isAdmin = hasRole(useCurrentUser(), 'admin');
  if (!isAdmin || backupsConfigured !== false) return null;
  return (
    <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700">
      <h2 className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
        ⚠ {t.settings.backupsWarnTitle}
      </h2>
      <p className="text-sm text-amber-900 dark:text-amber-200">
        {t.settings.backupsWarnBody}
        <span className="font-mono">BACKUPS_CONFIGURED</span>
        {t.settings.backupsWarnBody2}
      </p>
      <a
        href={SELF_HOSTING_DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-sm font-medium text-amber-900 underline dark:text-amber-200"
      >
        {t.settings.backupsWarnLink}
      </a>
    </Card>
  );
}

/** Full subscribable feed URL for a freshly minted feeds token. */
function calendarFeedUrl(token: string) {
  return `${window.location.origin}/feeds/loans.ics?token=${token}`;
}

/** End-of-day Date for a `YYYY-MM-DD` picker value, or null when empty. */
function parseExpiry(value: string): Date | null {
  return value ? new Date(`${value}T23:59:59`) : null;
}

/** `YYYY-MM-DD` for today, used as the earliest selectable expiry. */
function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Optional expiry date picker shared by the key/feed creation forms. */
function ExpiryField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <div className="min-w-[150px]">
      <Field label={t.settings.expiryLabel}>
        <Input
          type="date"
          value={value}
          min={todayInputValue()}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    </div>
  );
}

/**
 * End-user friendly calendar subscription. Each link is backed by a
 * `feeds`-only key, so its token (which travels in the URL) grants read-only
 * access to loan dates and nothing else — see the scopes note in
 * @inventory-hub/shared.
 */
function CalendarFeedSection() {
  const t = useT();
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => apiClient.apiKeys.list() });
  const links = keys.data?.items.filter((k) => k.scopes.includes('feeds')) ?? [];
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiClient.apiKeys.create({
        name: name.trim(),
        scopes: ['feeds'],
        expiresAt: parseExpiry(expiresAt),
      }),
    onSuccess: (res) => {
      setCreated({ name: res.name, token: res.token });
      setName('');
      setExpiresAt('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.apiKeys.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  return (
    <Card>
      <h2 className="font-semibold mb-2">{t.settings.calendarTitle}</h2>
      <p className="text-xs text-slate-500 mb-3">
        {t.settings.calendarIntro1}
        <strong>{t.settings.calendarIntroReadOnly}</strong>
        {t.settings.calendarIntro2}
      </p>

      {created && (
        <div className="mb-3 rounded border border-emerald-300 bg-emerald-50 p-3 dark:bg-emerald-950/30 dark:border-emerald-700">
          <p className="text-sm font-medium mb-1">
            {t.settings.calendarCreatedTitle(created.name)}
          </p>
          <code className="block break-all rounded bg-white dark:bg-slate-800 p-2 font-mono text-xs">
            {calendarFeedUrl(created.token)}
          </code>
          <p className="text-xs text-slate-500 mt-1">{t.settings.calendarCreatedHint}</p>
          <Button variant="ghost" className="text-xs mt-1" onClick={() => setCreated(null)}>
            {t.settings.copiedDone}
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
          <Field label={t.settings.linkNameLabel} required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.settings.linkNamePlaceholder}
            />
          </Field>
        </div>
        <ExpiryField value={expiresAt} onChange={setExpiresAt} />
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? t.settings.creating : t.settings.createLink}
        </Button>
      </form>
      {create.error && <p className="text-sm text-red-600 mb-2">{errorMessage(create.error)}</p>}

      {links.length === 0 ? (
        <p className="text-sm text-slate-500">{t.settings.calendarLinksEmpty}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {links.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <span className="font-medium">{k.name}</span>{' '}
                <span className="font-mono text-xs text-slate-500">{k.prefix}…</span>
                <div className="text-xs text-slate-500">
                  {k.lastUsedAt
                    ? t.settings.lastUsed(formatDate(k.lastUsedAt))
                    : t.settings.neverUsed}
                  {k.expiresAt && ` · ${t.settings.validUntil(formatDate(k.expiresAt))}`}
                </div>
              </div>
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                disabled={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: t.settings.cancelLinkTitle(k.name),
                      message: t.settings.cancelLinkMessage,
                      confirmLabel: t.settings.cancelLinkConfirm,
                      danger: true,
                    })
                  ) {
                    remove.mutate(k.id, {
                      onSuccess: () => toast.success(t.settings.linkCancelled),
                    });
                  }
                }}
              >
                {t.settings.cancelLinkButton}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ApiKeysSection() {
  const t = useT();
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => apiClient.apiKeys.list() });
  // REST keys only; calendar links live in their own section.
  const apiKeys = keys.data?.items.filter((k) => k.scopes.includes('api')) ?? [];
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiClient.apiKeys.create({
        name: name.trim(),
        scopes: ['api'],
        expiresAt: parseExpiry(expiresAt),
      }),
    onSuccess: (res) => {
      setCreated({ name: res.name, token: res.token });
      setName('');
      setExpiresAt('');
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
        <h2 className="font-semibold">{t.settings.apiKeysTitle}</h2>
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          {t.settings.apiDocsLink}
        </a>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        {t.settings.apiKeysIntro1}
        <span className="font-mono">Authorization: Bearer …</span>
        {t.settings.apiKeysIntro2}
      </p>

      {created && (
        <div className="mb-3 rounded border border-emerald-300 bg-emerald-50 p-3 dark:bg-emerald-950/30 dark:border-emerald-700">
          <p className="text-sm font-medium mb-1">{t.settings.apiKeyCreatedTitle(created.name)}</p>
          <code className="block break-all rounded bg-white dark:bg-slate-800 p-2 font-mono text-xs">
            {created.token}
          </code>
          <Button variant="ghost" className="text-xs mt-1" onClick={() => setCreated(null)}>
            {t.settings.copiedDone}
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
          <Field label={t.settings.keyNameLabel} required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.settings.keyNamePlaceholder}
            />
          </Field>
        </div>
        <ExpiryField value={expiresAt} onChange={setExpiresAt} />
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? t.settings.creating : t.settings.createKey}
        </Button>
      </form>
      {create.error && <p className="text-sm text-red-600 mb-2">{errorMessage(create.error)}</p>}

      {apiKeys.length === 0 ? (
        <p className="text-sm text-slate-500">{t.settings.apiKeysEmpty}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {apiKeys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <span className="font-medium">{k.name}</span>{' '}
                <span className="font-mono text-xs text-slate-500">{k.prefix}…</span>{' '}
                {k.scopes.includes('feeds') && (
                  <span className="ml-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    + {t.settings.scopeFeeds}
                  </span>
                )}
                <div className="text-xs text-slate-500">
                  {k.lastUsedAt
                    ? t.settings.lastUsed(formatDate(k.lastUsedAt))
                    : t.settings.neverUsed}
                  {k.expiresAt && ` · ${t.settings.validUntil(formatDate(k.expiresAt))}`}
                </div>
              </div>
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                disabled={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: t.settings.cancelKeyTitle(k.name),
                      message: t.settings.cancelKeyMessage,
                      confirmLabel: t.settings.cancelKeyConfirm,
                      danger: true,
                    })
                  ) {
                    remove.mutate(k.id, {
                      onSuccess: () => toast.success(t.settings.keyCancelled),
                    });
                  }
                }}
              >
                {t.settings.cancelLinkButton}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function McpConnectionSection() {
  const t = useT();
  const info = useQuery({ queryKey: ['mcp-info'], queryFn: () => apiClient.org.mcpInfo() });
  const url = info.data?.url ?? '';
  const command = `claude mcp add --transport http inventory-hub ${url}`;
  const googleConfigured = info.data?.googleConfigured ?? false;

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">{t.settings.mcpTitle}</h2>
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          {t.settings.apiDocsLink}
        </a>
      </div>
      <p className="text-xs text-slate-500 mb-3">{t.settings.mcpIntro}</p>

      {info.isLoading && <p className="text-sm text-slate-500">{t.common.loading}</p>}

      {!info.isLoading && !googleConfigured && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200">
          {t.settings.mcpGoogleWarn1}
          <span className="font-mono">GOOGLE_CLIENT_ID</span> /{' '}
          <span className="font-mono">SECRET</span> /{' '}
          <span className="font-mono">REDIRECT_URL</span>
          {t.settings.mcpGoogleWarn2}
        </p>
      )}

      {!info.isLoading && (
        <div className="space-y-3">
          <CopyField label={t.settings.mcpConnectorUrlLabel} text={url} />
          <CopyField label={t.settings.mcpCommandLabel} text={command} />
        </div>
      )}

      <p className="text-xs text-slate-500 mt-3">
        {t.settings.mcpFooter1}
        <strong>{t.settings.mcpFooterReadWrite}</strong>
        {t.settings.mcpFooter2}
        <strong>{t.settings.mcpFooterReadOnly}</strong>
        {t.settings.mcpFooter3}
      </p>
    </Card>
  );
}

function CopyField({ label, text }: { label: string; text: string }) {
  const t = useT();
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
          {copied ? t.common.copied : t.common.copy}
        </Button>
      </div>
    </div>
  );
}

function InvitationsSection() {
  const t = useT();
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
      <h2 className="font-semibold mb-2">{t.settings.invitationsTitle}</h2>
      <p className="text-xs text-slate-500 mb-3">{t.settings.invitationsIntro}</p>

      <form
        className="flex flex-wrap gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (email) create.mutate();
        }}
      >
        <div className="flex-1 min-w-[200px]">
          <Field label={t.settings.emailLabel} required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.settings.emailPlaceholder}
            />
          </Field>
        </div>
        <div className="w-40">
          <Field label={t.common.role}>
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="member">{t.common.roles.member}</option>
              <option value="operator">{t.common.roles.operator}</option>
              <option value="auditor">{t.common.roles.auditor}</option>
              <option value="admin">{t.common.roles.admin}</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending || !email}>
          {t.settings.invite}
        </Button>
      </form>

      {create.error && <p className="text-sm text-red-600 mt-2">{errorMessage(create.error)}</p>}

      {lastUrl && (
        <div className="mt-3 p-3 rounded bg-emerald-50 border border-emerald-200 text-xs space-y-1">
          <p className="font-medium">{t.settings.invitationCreated}</p>
          <code className="block break-all">{lastUrl}</code>
          <Button
            variant="secondary"
            className="text-xs"
            onClick={() => navigator.clipboard.writeText(lastUrl)}
          >
            {t.common.copy}
          </Button>
        </div>
      )}

      <ul className="divide-y border rounded mt-4">
        {list.data?.items.length === 0 && (
          <li className="p-3 text-sm text-slate-500">{t.settings.invitationsEmpty}</li>
        )}
        {list.data?.items.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between p-3 gap-2">
            <div>
              <p className="text-sm font-medium">{inv.email}</p>
              <p className="text-xs text-slate-500">
                {t.settings.invitationMeta(
                  t.common.roles[inv.role] ?? inv.role,
                  formatDate(inv.expiresAt),
                )}
              </p>
            </div>
            <Button
              variant="ghost"
              className="text-red-600 text-xs"
              onClick={() => remove.mutate(inv.id)}
            >
              {t.settings.cancelInvitationButton}
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
  const t = useT();
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
          <li className="p-3 text-sm text-slate-500">{t.settings.allowedDomainsEmpty}</li>
        )}
        {value.map((d) => (
          <li key={d.domain} className="flex items-center justify-between p-2 gap-2">
            <span className="font-mono text-sm">{d.domain}</span>
            <span className="text-xs text-slate-500">
              → {t.common.roles[d.defaultRole] ?? d.defaultRole}
            </span>
            <Button
              variant="ghost"
              className="text-red-600 text-xs"
              onClick={() => onChange(value.filter((x) => x.domain !== d.domain))}
            >
              {t.settings.removeDomain}
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Field label={t.settings.domainLabel}>
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
          <Field label={t.settings.defaultRoleLabel}>
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="member">{t.common.roles.member}</option>
              <option value="operator">{t.common.roles.operator}</option>
              <option value="auditor">{t.common.roles.auditor}</option>
              <option value="admin">{t.common.roles.admin}</option>
            </Select>
          </Field>
        </div>
        <Button type="button" variant="secondary" onClick={add}>
          {t.settings.addDomain}
        </Button>
      </div>
    </div>
  );
}
