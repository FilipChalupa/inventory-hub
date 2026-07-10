import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { useT } from '../i18n/index.js';

export function AcceptInvitePage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => apiClient.auth.getInvite(token),
    enabled: !!token,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => apiClient.auth.acceptInvite(token, name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      navigate('/');
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold">{t.acceptInvite.title}</h1>

        {!token && <p className="text-sm text-red-600">{t.acceptInvite.missingToken}</p>}

        {invite.isLoading && (
          <p className="text-sm text-slate-500">{t.acceptInvite.loadingInvite}</p>
        )}
        {invite.error && <p className="text-sm text-red-600">{errorMessage(invite.error)}</p>}

        {invite.data && (
          <>
            <p className="text-sm text-slate-700">
              {t.acceptInvite.inviteFor}
              <span className="font-mono">{invite.data.email}</span>
              {t.acceptInvite.roleLabel}
              <span className="font-medium">{invite.data.role}</span>.
            </p>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) accept.mutate();
              }}
            >
              <Field label={t.acceptInvite.yourName} required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.acceptInvite.namePlaceholder}
                />
              </Field>
              {accept.error && <p className="text-sm text-red-600">{errorMessage(accept.error)}</p>}
              <Button type="submit" disabled={accept.isPending || !name.trim()} className="w-full">
                {accept.isPending ? t.acceptInvite.creatingAccount : t.acceptInvite.accept}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
