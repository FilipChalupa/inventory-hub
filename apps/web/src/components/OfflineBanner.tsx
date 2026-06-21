import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';

/**
 * Sticky banner that surfaces the offline state to the user. We only show
 * it when `navigator.onLine` flips to false (or initially), and clear it
 * once the connection comes back. Writes from the UI will fail; reads can
 * still work from the service-worker cache.
 */
export function OfflineBanner() {
  const t = useT();
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;
  return (
    <div className="bg-amber-100 text-amber-900 text-sm py-1 px-4 text-center border-b border-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-800 print:hidden">
      {t.components.offlineMessage}
    </div>
  );
}
