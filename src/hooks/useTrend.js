import { useEffect, useState } from 'react';

/**
 * Loads one of the service view's history series and keeps it fresh.
 *
 * The three sparklines — battery, enclosure, wifi — all want the same two
 * things, and neither is obvious enough to leave to each caller.
 *
 * Refetching on `freshness` rather than only on mount is the first. The battery
 * series used to be frozen at whatever the pack read when the view was opened,
 * which looks identical to a working chart and is wrong the moment you leave the
 * tab open. Pass the timestamp of the newest reading and the series follows the
 * node instead of the page load.
 *
 * The `isMounted` guard is the second: `hours` changes on a click, so a slow
 * response for 7 d can land after a fast one for 24 h and overwrite it with
 * stale data. Ignoring resolutions from a superseded effect is what keeps the
 * chart showing the range whose button is lit.
 *
 * Each point gets a numeric `t` alongside its ISO `time`, because Recharts needs
 * a number for a time-scaled axis and doing it per render would rebuild the array
 * on every SSE push.
 */
export const useTrend = (fetcher, hours, freshness) => {
    const [points, setPoints] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        fetcher(hours)
            .then((rows) => {
                if (!isMounted) return;
                setPoints(rows.map((p) => ({ ...p, t: new Date(p.time).getTime() })));
                setError(null);
            })
            .catch((err) => isMounted && setError(err.message));
        return () => { isMounted = false; };
        // fetcher is a module-level function in ServiceApi, stable across renders.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hours, freshness]);

    return { points, error };
};
