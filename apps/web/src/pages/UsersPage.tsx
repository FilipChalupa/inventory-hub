import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { apiClient } from '../lib/api.js';
import { Button, Card, Select, formatDate } from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { USER_ROLES, type UserRole } from '@inventory-hub/shared';
import { useCurrentUser } from '../auth/AuthContext.js';

export function UsersPage() {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const list = useQuery({ queryKey: ['users'], queryFn: () => apiClient.users.list() });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { role?: UserRole; disabled?: boolean } }) =>
      apiClient.users.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Uživatelé</h1>
      <p className="text-sm text-slate-600">
        Spravuj role a deaktivuj uživatele, kteří už nemají mít přístup. Pozvánky se
        zakládají v <a href="/settings" className="text-blue-600 hover:underline">Nastavení</a>.
      </p>

      <Card>
        <ul className="divide-y">
          {list.data?.items.length === 0 && (
            <li className="py-3 text-sm text-slate-500">Žádní uživatelé.</li>
          )}
          {list.data?.items.map((u) => {
            const isMe = me?.id === u.id;
            const disabled = u.disabledAt !== null;
            return (
              <li key={u.id} className="py-3 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                  {u.imageUrl ? (
                    <img src={u.imageUrl} alt="" className="w-9 h-9 rounded-full" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-700">
                      {u.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium">
                      {u.name} {isMe && <span className="text-xs text-slate-500">(ty)</span>}
                    </p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </div>
                </div>

                <Select
                  value={u.role}
                  disabled={(isMe && u.role === 'admin') || disabled}
                  onChange={(e) =>
                    update.mutate({ id: u.id, input: { role: e.target.value as UserRole } })
                  }
                  className="w-36"
                >
                  {USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>

                {disabled ? (
                  <>
                    <span className="text-xs text-slate-500">
                      deaktivován {formatDate(u.disabledAt)}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => update.mutate({ id: u.id, input: { disabled: false } })}
                    >
                      Aktivovat
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    className="text-red-600"
                    disabled={isMe}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Deaktivovat uživatele ${u.email}?`,
                          message: 'Ztratí přístup do aplikace. Lze ho později znovu aktivovat.',
                          confirmLabel: 'Deaktivovat',
                          danger: true,
                        })
                      ) {
                        update.mutate(
                          { id: u.id, input: { disabled: true } },
                          { onSuccess: () => toast.success('Uživatel deaktivován') },
                        );
                      }
                    }}
                  >
                    Deaktivovat
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {update.error && (
          <p className="text-sm text-red-600 mt-2">{errorMessage(update.error)}</p>
        )}
      </Card>
    </section>
  );
}
