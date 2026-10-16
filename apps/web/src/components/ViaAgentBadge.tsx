import { useT } from '../i18n/index.js';

/** Marks an audit/history entry that an AI agent performed over MCP. */
export function ViaAgentBadge({ via }: { via: string | null | undefined }) {
  const t = useT();
  if (!via) return null;
  return (
    <span
      title={t.components.viaAgentTitle(via)}
      className="ml-1 inline-block rounded-sm bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
    >
      🤖 {t.components.viaAgent}: {via}
    </span>
  );
}
