import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAuth } from './AuthContext';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const DISMISSED_AT_KEY = 'diskSpaceBannerDismissedFreeMb';

// Admin-only: mirrors every other system-health surface (git-pull, database
// tools, audit logs) which are all gated behind 'system_settings'.
const DiskSpaceBanner = () => {
  const { authFetch, canPerform } = useAuth();
  const [usage, setUsage] = useState(null);
  const [dismissedAtFreeMb, setDismissedAtFreeMb] = useState(() => {
    try {
      const stored = sessionStorage.getItem(DISMISSED_AT_KEY);
      return stored === null ? null : Number(stored);
    } catch {
      return null;
    }
  });
  const isAdmin = canPerform('system_settings');

  const checkDiskUsage = useCallback(async () => {
    try {
      const response = await authFetch('/api/v1/system/disk-usage');
      if (!response.ok) return;
      const data = await response.json();
      setUsage(data);
    } catch {
      // Silent — this is a proactive warning, not a critical path.
    }
  }, [authFetch]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    checkDiskUsage();
    const interval = setInterval(checkDiskUsage, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isAdmin, checkDiskUsage]);

  const dismiss = () => {
    setDismissedAtFreeMb(usage.free_mb);
    try {
      sessionStorage.setItem(DISMISSED_AT_KEY, String(usage.free_mb));
    } catch {
      // Storage unavailable (private browsing, etc.) — dismissal just won't
      // survive a reload, which is fine, it's not load-bearing.
    }
  };

  if (!isAdmin || !usage?.low_space_warning) return null;
  // Stay dismissed unless space has dropped further since the last dismissal,
  // so a worsening problem re-surfaces instead of staying silenced forever.
  if (dismissedAtFreeMb !== null && usage.free_mb >= dismissedAtFreeMb) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 mb-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
      <AlertTriangle size={20} className="mt-0.5 flex-shrink-0" />
      <div className="text-sm flex-1">
        <p className="font-semibold">
          Device storage is critically low ({usage.percent_used}% full, {usage.free_mb}MB free)
        </p>
        <p className="mt-0.5">
          Software updates are disabled until space is freed, and a full disk can
          cause running tests to silently fail to save new data points. Free up
          space in Settings (old database backups, logs) as soon as possible.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss low storage warning"
        className="flex-shrink-0 rounded p-1 text-amber-700 hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-800/40"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default DiskSpaceBanner;
