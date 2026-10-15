import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MCP_TOKEN_EXPIRY_DAYS, type McpAccess } from '@inventory-hub/shared';
import { apiClient, type McpConnectionRow } from '../lib/api.js';
import { errorMessage } from '../lib/errors.js';
import { Button, Card, Field, Input, Select, formatDate } from '../components/ui.js';
import { CopyField } from '../components/CopyField.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { useT } from '../i18n/index.js';
import { hasRole, useCurrentUser } from '../auth/AuthContext.js';

/**
 * Self-service page (every role) for wiring Inventory Hub into an AI agent
 * over MCP: the OAuth connector details, personal bearer tokens for agents
 * that can't do OAuth, and the list of live connections with a disconnect
 * button. Admins also get the org-wide list.
 */
export function AgentsPage() {
  const t = useT();
  const isAdmin = hasRole(useCurrentUser(), 'admin');
  const info = useQuery({ queryKey: ['mcp-info'], queryFn: () => apiClient.org.mcpInfo() });
  const url = info.data?.url ?? '';

  return (
    <section className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">{t.agents.title}</h1>
        <p className="text-sm text-slate-500 mt-1">{t.agents.intro}</p>
      </div>

      <Card>
        <h2 className="font-semibold mb-2">{t.agents.connectTitle}</h2>
        <p className="text-xs text-slate-500 mb-3">{t.agents.connectIntro}</p>
        {info.isLoading ? (
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        ) : (
          <>
            {!info.data?.googleConfigured && (
              <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200">
                ⚠ {t.agents.googleWarn}
              </p>
            )}
            <div className="space-y-3">
              <CopyField label={t.agents.connectorUrlLabel} text={url} />
              <CopyField
                label={t.agents.claudeCodeLabel}
                text={`claude mcp add --transport http inventory-hub ${url}`}
              />
            </div>
          </>
        )}
      </Card>

      <PersonalTokenSection url={url} />

      <ConnectionsSection title={t.agents.myTitle} empty={t.agents.myEmpty} />

      {isAdmin && (
        <ConnectionsSection
          all
          title={t.agents.orgTitle}
          intro={t.agents.orgIntro}
          empty={t.agents.orgEmpty}
        />
      )}
    </section>
  );
}

function PersonalTokenSection({ url }: { url: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [access, setAccess] = useState<McpAccess>('read');
  // Select values are strings; '' encodes "never expires".
  const [expiry, setExpiry] = useState('90');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiClient.mcpConnections.createToken({
        name: name.trim(),
        access,
        expiresInDays: expiry ? Number(expiry) : null,
      }),
    onSuccess: (res) => {
      setCreated({ name: res.name, token: res.token });
      setName('');
      qc.invalidateQueries({ queryKey: ['mcp-connections'] });
    },
  });

  return (
    <Card>
      <h2 className="font-semibold mb-2">{t.agents.tokenTitle}</h2>
      <p className="text-xs text-slate-500 mb-3">{t.agents.tokenIntro}</p>

      {created && (
        <div className="mb-3 space-y-3 rounded border border-emerald-300 bg-emerald-50 p-3 dark:bg-emerald-950/30 dark:border-emerald-700">
          <p className="text-sm font-medium">{t.agents.tokenCreatedTitle(created.name)}</p>
          <CopyField label={t.agents.tokenLabel} text={created.token} />
          <CopyField
            label={t.agents.tokenCommandLabel}
            text={`claude mcp add --transport http inventory-hub ${url} --header "Authorization: Bearer ${created.token}"`}
          />
          <CopyField
            label={t.agents.tokenJsonLabel}
            text={JSON.stringify(
              {
                mcpServers: {
                  'inventory-hub': {
                    type: 'http',
                    url,
                    headers: { Authorization: `Bearer ${created.token}` },
                  },
                },
              },
              null,
              2,
            )}
          />
          <Button variant="ghost" className="text-xs" onClick={() => setCreated(null)}>
            {t.agents.done}
          </Button>
        </div>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="flex-1 min-w-[160px]">
          <Field label={t.agents.tokenNameLabel} required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.agents.tokenNamePlaceholder}
              maxLength={100}
            />
          </Field>
        </div>
        <Field label={t.agents.accessLabel}>
          <Select value={access} onChange={(e) => setAccess(e.target.value as McpAccess)}>
            <option value="read">{t.agents.accessRead}</option>
            <option value="read-write">{t.agents.accessReadWrite}</option>
          </Select>
        </Field>
        <Field label={t.agents.expiryLabel}>
          <Select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {MCP_TOKEN_EXPIRY_DAYS.map((d) => (
              <option key={d} value={String(d)}>
                {t.agents.expiryDays(d)}
              </option>
            ))}
            <option value="">{t.agents.expiryNever}</option>
          </Select>
        </Field>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? t.agents.creating : t.agents.createToken}
        </Button>
      </form>
      {create.error && <p className="text-sm text-red-600 mt-2">{errorMessage(create.error)}</p>}
    </Card>
  );
}

function ConnectionsSection({
  all = false,
  title,
  intro,
  empty,
}: {
  all?: boolean;
  title: string;
  intro?: string;
  empty: string;
}) {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['mcp-connections', all ? 'all' : 'mine'],
    queryFn: () => apiClient.mcpConnections.list({ all }),
  });
  const revoke = useMutation({
    mutationFn: (c: McpConnectionRow) => apiClient.mcpConnections.revoke(c),
    onSuccess: () => {
      toast.success(t.agents.disconnected);
      qc.invalidateQueries({ queryKey: ['mcp-connections'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const items = list.data?.items ?? [];

  return (
    <Card>
      <h2 className="font-semibold mb-2">{title}</h2>
      {intro && <p className="text-xs text-slate-500 mb-3">{intro}</p>}
      {list.isLoading ? (
        <p className="text-sm text-slate-500">{t.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {items.map((c) => (
            <li
              key={`${c.kind}:${c.id}:${c.user.id}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium break-all">{c.name}</span>
                  {c.tokenPrefix && (
                    <span className="font-mono text-xs text-slate-500">{c.tokenPrefix}…</span>
                  )}
                  <Pill>{c.kind === 'oauth' ? t.agents.kindOauth : t.agents.kindPersonal}</Pill>
                  <Pill tone={c.access === 'read-write' ? 'warn' : 'default'}>
                    {c.access === 'read-write' ? t.agents.accessReadWrite : t.agents.accessRead}
                  </Pill>
                </div>
                {all && (
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    {c.user.name} · {c.user.email}
                  </div>
                )}
                <div className="text-xs text-slate-500">
                  {t.agents.connectedAt(formatDate(c.createdAt))} ·{' '}
                  {c.lastUsedAt ? t.agents.lastUsed(formatDate(c.lastUsedAt)) : t.agents.neverUsed}{' '}
                  · {c.expiresAt ? t.agents.expires(formatDate(c.expiresAt)) : t.agents.noExpiry}
                </div>
              </div>
              <Button
                variant="ghost"
                className="text-red-600 text-xs shrink-0"
                disabled={revoke.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: t.agents.disconnectTitle(c.name),
                      message: t.agents.disconnectMessage,
                      confirmLabel: t.agents.disconnect,
                      danger: true,
                    })
                  ) {
                    revoke.mutate(c);
                  }
                }}
              >
                {t.agents.disconnect}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Pill({ children, tone = 'default' }: { children: string; tone?: 'default' | 'warn' }) {
  return (
    <span
      className={
        tone === 'warn'
          ? 'inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
          : 'inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300'
      }
    >
      {children}
    </span>
  );
}
