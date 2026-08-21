import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
    formatDayTime, formatFixed, formatNumber, localHour, localDayKey,
} from '../../utils/timezone';

const TEMP = '#ff6b6b';
const ENVELOPE = '#ff6b6b';

/*
  Below this many hours the hour-of-day profile is not a profile. It averages
  each local hour across the days in the window, so at 24 h every "average" is a
  single reading and the chart is the raw series wearing a costume — worse than
  absent, because it looks like a climatology and isn't one. Three days is the
  first range where each hour has enough to average that the shape means
  something.
*/
const PROFILE_MIN_HOURS = 72;

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
const COMPLETE_DAY_HOURS = 20;

/**
 * The expanded view of the temperature reading.
 *
 * Everything here used to be either on the card or nowhere. The card kept the
 * live figure and its trend — the two things worth glancing at — and handed over
 * the extremes, the day-ago comparison, and the questions nobody could ask
 * before: what the whole window looked like, how wide a typical day swings, and
 * what shape this station's average day has.
 *
 * The numbers are derived from the history already in memory rather than
 * fetched. The dashboard has fetched exactly this window for the chart below it,
 * so a second request would spend 3-5 s against the Pi to arrive at the same
 * array. It also means the range selector belongs to the dashboard and is shared
 * with it, not duplicated here: changing the window in either place changes it
 * in both, and there is only ever one answer to "which window am I looking at".
 */
const TemperatureDetail = ({
    history, currentData, stats, hours,
    // Handed down rather than recomputed: the dashboard derives these from the
    // series it actually loaded, not from the selected range, so that a chart
    // still showing yesterday's window while a fortnight loads is not relabelled
    // with dates it does not span. Deriving them again here would reintroduce
    // exactly that bug in a second place.
    axisTimeFormat, tooltipTimeFormat, axisTickGap,
}) => {
    const { t } = useTranslation('dashboard');

    const derived = useMemo(() => {
        const pts = (history ?? []).filter((p) => typeof p.temperature === 'number');
        if (!pts.length) return null;

        let max = pts[0];
        let min = pts[0];
        let sum = 0;
        // Per local day, so the swing is a day's swing and not a window's. Each
        // day also collects which hours it actually saw, because the first and
        // last days of a window are nearly always partial and only whole ones
        // can be averaged — see COMPLETE_DAY_HOURS.
        const days = new Map();

        for (const p of pts) {
            if (p.temperature > max.temperature) max = p;
            if (p.temperature < min.temperature) min = p;
            sum += p.temperature;

            const key = localDayKey(p.uniqueTime);
            const hour = localHour(p.uniqueTime);
            if (!key) continue;
            let d = days.get(key);
            if (!d) {
                d = { hi: p.temperature, lo: p.temperature, hours: new Set() };
                days.set(key, d);
            } else {
                if (p.temperature > d.hi) d.hi = p.temperature;
                if (p.temperature < d.lo) d.lo = p.temperature;
            }
            if (hour != null) d.hours.add(hour);
        }

        const complete = [...days.values()].filter((d) => d.hours.size >= COMPLETE_DAY_HOURS);
        const meanSwing = complete.length
            ? complete.reduce((a, d) => a + (d.hi - d.lo), 0) / complete.length
            : null;

        // The envelope is the point of this chart, not the mean line: it says
        // "at 07:00 this station has been as cold as X and as warm as Y", which
        // is the question the raw series cannot answer without counting days.
        const buckets = Array.from({ length: 24 }, () => ({ sum: 0, n: 0, lo: Infinity, hi: -Infinity }));
        for (const p of pts) {
            const h = localHour(p.uniqueTime);
            if (h == null) continue;
            const b = buckets[h];
            b.sum += p.temperature;
            b.n += 1;
            if (p.temperature < b.lo) b.lo = p.temperature;
            if (p.temperature > b.hi) b.hi = p.temperature;
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
            mean: sum / pts.length,
            // Two counts, because they answer different questions: the swing is
            // averaged over whole days only, while the profile uses every
            // reading in the window — a partial day still contributes real
            // observations to the hours it does cover.
            completeDays: complete.length,
        };
    }, [history]);

    if (!derived) return <p className="metric-empty">{t('detail.noData')}</p>;

    const { max, min, mean, meanSwing, profile, completeDays } = derived;

    // Against the live reading, not against the end of the series: the card next
    // to it shows the live one, and two figures that disagree by a poll interval
    // read as a bug.
    const ref = stats?.temp24hAgo;
    const dayAgo = ref && typeof currentData?.temperature === 'number'
        ? currentData.temperature - ref.value
        : null;

    const stat = (key, value, unit, when, Icon, color) => (
        <div className="metric-stat">
            <div className="metric-stat-label">
                {Icon && <Icon size={13} aria-hidden="true" />}
                {t(`detail.temp.${key}`)}
            </div>
            <div className="metric-stat-value" style={color ? { color } : undefined}>
                {value}<span className="metric-stat-unit">{unit}</span>
            </div>
            {when && <div className="metric-stat-when">{when}</div>}
        </div>
    );

    return (
        <>
            <div className="metric-stats">
                {stat('max', formatFixed(max.temperature, 1), '°C', formatDayTime(max.uniqueTime), ArrowUp, TEMP)}
                {stat('min', formatFixed(min.temperature, 1), '°C', formatDayTime(min.uniqueTime), ArrowDown, '#4dabf7')}
                {stat('mean', formatFixed(mean, 1), '°C', null)}
                {/*
                  Two different questions wearing one tile, and the label says
                  which one is being answered.

                  With whole days to average, "daily swing" is a climate figure:
                  how much a day here typically moves. Without them it falls back
                  to the plain span of the window, which is a fact about this
                  window and nothing more — worth showing, because subtracting the
                  two tiles to its left in your head is friction for a number
                  people actually want, but not worth calling "daily" when it
                  covers six hours.

                  Two whole days rather than one, because a mean over a single
                  day is that day, and "averaged over 1 day" invites the reader to
                  trust it as a typical value.
                */}
                {completeDays >= 2
                    ? stat(
                        'swing', formatFixed(meanSwing, 1), '°C',
                        t('detail.temp.swingOver', { count: completeDays }),
                    )
                    : stat(
                        'span', formatFixed(max.temperature - min.temperature, 1), '°C',
                        t('detail.temp.spanNote'),
                    )}
                {dayAgo != null && stat(
                    'dayAgo', formatNumber(dayAgo, { digits: 1, minDigits: 1, sign: 'always' }), '°C',
                    t('detail.temp.dayAgoRef', { temp: formatFixed(ref.value, 1) }),
                )}
            </div>

            <h3 className="metric-section">{t('detail.temp.seriesTitle')}</h3>
            <div className="metric-chart">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="detailTempFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={TEMP} stopOpacity={0.35} />
                                <stop offset="95%" stopColor={TEMP} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff14" />
                        <XAxis
                            dataKey="uniqueTime" stroke="#ffffff66" tick={{ fontSize: 11 }}
                            minTickGap={axisTickGap} tickFormatter={axisTimeFormat}
                        />
                        <YAxis
                            stroke="#ffffff66" tick={{ fontSize: 11 }} width={52}
                            tickFormatter={(v) => `${formatFixed(v, 0)}°`}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' }}
                            itemStyle={{ color: '#e4e4e7' }}
                            labelStyle={{ color: '#a1a1aa' }}
                            labelFormatter={tooltipTimeFormat}
                            formatter={(value) => [`${formatFixed(value, 2)} °C`, t('detail.temp.series')]}
                        />
                        {/* The two extremes are marked rather than left to be
                            hunted for: the stat block above names them, and a
                            number you cannot find on the chart it came from is a
                            claim rather than a reading. */}
                        <ReferenceLine y={max.temperature} stroke={TEMP} strokeDasharray="4 4" strokeOpacity={0.6} />
                        <ReferenceLine y={min.temperature} stroke="#4dabf7" strokeDasharray="4 4" strokeOpacity={0.6} />
                        <Area
                            type="monotone" dataKey="temperature" name={t('detail.temp.series')}
                            stroke={TEMP} strokeWidth={2} fill="url(#detailTempFill)"
                            dot={false} isAnimationActive={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <h3 className="metric-section">{t('detail.temp.profileTitle')}</h3>
            {hours < PROFILE_MIN_HOURS ? (
                <p className="metric-note">{t('detail.temp.profileNeedsRange')}</p>
            ) : (
                <>
                    {/* No day count here, deliberately. This chart averages every
                        reading in the window while the swing above averages only
                        whole days, so the two honest counts differ — and two
                        different numbers of days a few centimetres apart read as a
                        bug rather than as a distinction. The one that has to
                        justify its figure keeps it. */}
                    <p className="metric-note">{t('detail.temp.profileIntro')}</p>
                    <div className="metric-chart metric-chart-short">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={profile} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff14" />
                                {/* Every third hour, fixed. A gap-based rule on a
                                    category axis lets recharts pick whichever
                                    labels happen to fit, and it produced 00-02-04
                                    then 10-11-12-13 — an axis whose spacing changes
                                    halfway across reads as missing data. */}
                                <XAxis dataKey="label" stroke="#ffffff66" tick={{ fontSize: 11 }} interval={2} />
                                <YAxis
                                    stroke="#ffffff66" tick={{ fontSize: 11 }} width={52}
                                    tickFormatter={(v) => `${formatFixed(v, 0)}°`}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' }}
                                    itemStyle={{ color: '#e4e4e7' }}
                                    labelStyle={{ color: '#a1a1aa' }}
                                    formatter={(value, name) => [
                                        Array.isArray(value)
                                            ? `${formatFixed(value[0], 1)} – ${formatFixed(value[1], 1)} °C`
                                            : `${formatFixed(value, 1)} °C`,
                                        name,
                                    ]}
                                />
                                <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                                {/* legendType, because the default draws this band
                                    as a line with a dot — the same mark the mean
                                    gets, in the same hue. Two identical swatches
                                    label two things that look nothing alike on the
                                    chart. */}
                                <Area
                                    type="monotone" dataKey="envelope" name={t('detail.temp.profileRange')}
                                    stroke="none" fill={ENVELOPE} fillOpacity={0.18}
                                    legendType="rect" isAnimationActive={false}
                                />
                                <Line
                                    type="monotone" dataKey="mean" name={t('detail.temp.profileMean')}
                                    stroke={TEMP} strokeWidth={2.2} dot={false}
                                    isAnimationActive={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </>
    );
};

export default TemperatureDetail;
