import { localHour, localDayKey } from '../../utils/timezone';

/*
  A local day counts towards the average swing only if this many distinct hours
  of it were recorded. The window almost always starts and ends mid-day, and a
  partial day understates its own swing — a window opening at 16:00 never sees
  that day's dawn minimum. Averaging those in drags the figure down by however
  much of the day happened to be outside the range, which makes the number a
  property of when you looked rather than of the weather.

  20 rather than 24 because a single missed publish should not disqualify a day,
  and the extremes of a day are hours apart from each other.
*/
export const COMPLETE_DAY_HOURS = 20;

/*
  Below this many hours the hour-of-day profile is not a profile. It averages
  each local hour across the days in the window, so at 24 h every "average" is a
  single reading and the chart is the raw series wearing a costume — worse than
  absent, because it looks like a climatology and isn't one. Three days is the
  first range where each hour has enough to average that the shape means
  something.
*/
export const PROFILE_MIN_HOURS = 72;

/**
 * Everything the detail views say about one field of the history series.
 *
 * Shared rather than written per metric because all four readings answer the
 * same questions — how high, how low, how much does it move, what does a typical
 * day look like — and four copies of this arithmetic would be four chances for
 * them to quietly disagree about what "average" spans.
 *
 * `points` is the history array the dashboard already loaded; `key` is the field
 * on each point. Returns null when nothing in the window carries that field, so
 * a sensor that stopped reporting reads as absent rather than as zero.
 */
export const seriesStats = (points, key) => {
    const pts = (points ?? []).filter((p) => typeof p[key] === 'number');
    if (!pts.length) return null;

    let max = pts[0];
    let min = pts[0];
    let sum = 0;
    // Per local day, so the swing is a day's swing and not a window's. Each day
    // also collects which hours it actually saw — see COMPLETE_DAY_HOURS.
    const days = new Map();

    for (const p of pts) {
        const v = p[key];
        if (v > max[key]) max = p;
        if (v < min[key]) min = p;
        sum += v;

        const dayKey = localDayKey(p.uniqueTime);
        const hour = localHour(p.uniqueTime);
        if (!dayKey) continue;
        let d = days.get(dayKey);
        if (!d) {
            d = { hi: v, lo: v, hours: new Set() };
            days.set(dayKey, d);
        } else {
            if (v > d.hi) d.hi = v;
            if (v < d.lo) d.lo = v;
        }
        if (hour != null) d.hours.add(hour);
    }

    const complete = [...days.values()].filter((d) => d.hours.size >= COMPLETE_DAY_HOURS);
    const meanSwing = complete.length
        ? complete.reduce((a, d) => a + (d.hi - d.lo), 0) / complete.length
        : null;

    // The envelope is the point of the profile chart, not the mean line: it says
    // "at 07:00 this station has been as low as X and as high as Y", which is the
    // question the raw series cannot answer without counting days by eye.
    const buckets = Array.from({ length: 24 }, () => ({ sum: 0, n: 0, lo: Infinity, hi: -Infinity }));
    for (const p of pts) {
        const h = localHour(p.uniqueTime);
        if (h == null) continue;
        const b = buckets[h];
        b.sum += p[key];
        b.n += 1;
        if (p[key] < b.lo) b.lo = p[key];
        if (p[key] > b.hi) b.hi = p[key];
    }
    const profile = buckets
        .map((b, h) => (b.n ? {
            hour: h,
            label: `${String(h).padStart(2, '0')}h`,
            mean: b.sum / b.n,
            envelope: [b.lo, b.hi],
            n: b.n,
        } : null))
        .filter(Boolean);

    return {
        max, min, meanSwing, profile,
        maxValue: max[key],
        minValue: min[key],
        mean: sum / pts.length,
        // The plain span of the window, for the ranges too short to hold whole
        // days. Not the same claim as meanSwing and never labelled as if it were.
        windowSwing: max[key] - min[key],
        // Two counts, because they answer different questions: the swing is
        // averaged over whole days only, while the profile uses every reading in
        // the window — a partial day still contributes real observations to the
        // hours it does cover.
        completeDays: complete.length,
        count: pts.length,
    };
};

/**
 * What fraction of the window sat at or above `threshold`.
 *
 * Returns null rather than 0 when the field is absent, for the same reason
 * seriesStats does: "the sensor said nothing" and "it was never that high" are
 * different answers.
 */
export const fractionAtOrAbove = (points, key, threshold) => {
    const pts = (points ?? []).filter((p) => typeof p[key] === 'number');
    if (!pts.length) return null;
    return pts.filter((p) => p[key] >= threshold).length / pts.length;
};
