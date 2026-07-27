import { useEffect, useState } from 'react';

/**
 * Ticking wall clock, for counters that have to move between server pushes.
 *
 * The backend sends absolute timestamps, never "seconds remaining" — a relative
 * number goes stale the instant it is serialised. Deriving the countdown from an
 * absolute instant against this clock means every server push re-anchors it, so
 * the display never drifts no matter how irregular the pushes are.
 */
export const useNow = (intervalMs = 1000) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);

    return now;
};
