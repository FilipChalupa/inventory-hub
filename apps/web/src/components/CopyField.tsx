import { useState } from 'react';
import { Button } from './ui.js';
import { useT } from '../i18n/index.js';

/** Read-only monospace value with a one-click copy button. */
export function CopyField({ label, text }: { label: string; text: string }) {
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
