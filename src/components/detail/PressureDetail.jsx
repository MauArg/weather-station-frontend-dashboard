import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatDayTime, formatFixed } from '../../utils/timezone';
import { seriesStats } from './seriesStats';
import StatTile from './StatTile';
import ProfileChart from './ProfileChart';
import TodayExtremes from './TodayExtremes';

const PRESSURE = '#ffd43b';
const LOW = '#a78bfa';

/**
 * The expanded view of the barometric reading.
 *
 * The chart that matters here is the profile below, not the series above, and
 * that inverts the usual order of these views. Pressure has a large, regular
 * daily cycle — the atmospheric tide — which the raw series shows as a ripple
 * nobody can separate from the weather by eye, and which the hour-of-day profile
 * shows as exactly what it is. It is also the reason the card's tendency badge
 * has the climatology subtracted out of it: see internal/pressuretrend.
 *
 * The QNH / station switch lives here rather than on the card. It was two click
 * targets on a card that now has one meaning, and the choice deserves a real
 * control instead of a chevron small enough to be deniable.
 */
const PressureDetail = ({
    history, stats, hours, mode, onModeChange, hasQnh, qnhOffset,
    axisTimeFormat, tooltipTimeFormat, axisTickGap,
}) => {
    const { t } = useTranslation('dashboard');

    /*
      Only the station reading is stored, so the sea-level series is derived by
      shifting it — the node reports both for the current instant, and their
      difference is the altitude correction, which does not change.

      Derived rather than fetched because storing a second series of the same
      measurement would create two things that can disagree, and because the
      offset is available for free from the live payload. It is a constant to
      four figures: the reduction depends on the station's height, not on the
      weather.
    */
    const data = useMemo(() => {
        if (mode !== 'qnh' || qnhOffset == null) return history ?? [];
        return (history ?? []).map((p) => ({
            ...p,
            pressure: typeof p.pressure === 'number' ? p.pressure + qnhOffset : p.pressure,
        }));
    }, [history, mode, qnhOffset]);

    const s = useMemo(() => seriesStats(data, 'pressure'), [data]);

    /*
      The tide comes from the backend, not from the window on screen.

      Computing it here was the first attempt and it was wrong in a way that
      looked right: over the 14 days this view can reach, the ~3 hPa tide sits
      under synoptic swings of 27, so the curve came out shallow with its minimum
      near 04:00 — where the real one, built from four months, puts it at 16:00.
      It looked like a tide and was mostly a record of which fronts crossed that
      fortnight. pressuretrend.MinDaysForClimatology is 30 for this reason.

      It also has to be the backend's copy rather than a good local
      approximation, because this chart's claim is that it is what the card's
      tendency had subtracted from it.
    */
    const tide = useMemo(() => {
        const c = stats?.pressureTide;
        if (!Array.isArray(c) || c.length !== 24) return [];
        return c.map((mean, hour) => ({
            hour,
            label: `${String(hour).padStart(2, '0')}h`,
            mean,
        }));
    }, [stats]);

    if (!s) return <p className="metric-empty">{t('detail.noData')}</p>;

    // Padded to the nearest whole hectopascal rather than to the data, because a
    // barometric axis is read against round numbers.
    const domain = [Math.floor(s.minValue) - 1, Math.ceil(s.maxValue) + 1];

    const todayShift = mode === 'qnh' && qnhOffset != null ? qnhOffset : 0;
    const shiftExtreme = (e) => (e ? { ...e, value: e.value + todayShift } : e);

    return (
        <>
            {hasQnh && (
                /* A segmented control, not the chevron this replaced: the two
                   readings are the same measurement in two frames, and the reader
                   should be able to see which one is showing without operating
                   anything. */
                <div className="metric-modes" role="group" aria-label={t('detail.pressure.modeAria')}>
                    {['qnh', 'station'].map((m) => (
                        <button
                            key={m}
                            type="button"
                            className="time-range-btn"
                            aria-pressed={mode === m}
                            onClick={() => onModeChange(m)}
                        >
                            {t(`pressure.${m}`)}
                        </button>
                    ))}
                </div>
            )}

            <div className="metric-stats">
                <StatTile
                    label={t('detail.max')} value={formatFixed(s.maxValue, 1)} unit="hPa"
                    when={formatDayTime(s.max.uniqueTime)} icon={ArrowUp} color={PRESSURE}
                />
                <StatTile
                    label={t('detail.min')} value={formatFixed(s.minValue, 1)} unit="hPa"
                    when={formatDayTime(s.min.uniqueTime)} icon={ArrowDown} color={LOW}
                />
                <StatTile label={t('detail.mean')} value={formatFixed(s.mean, 1)} unit="hPa" />
                {s.completeDays >= 2 ? (
                    <StatTile
                        label={t('detail.swing')} value={formatFixed(s.meanSwing, 1)} unit="hPa"
                        when={t('detail.swingOver', { count: s.completeDays })}
                    />
                ) : (
                    <StatTile
                        label={t('detail.span')} value={formatFixed(s.windowSwing, 1)} unit="hPa"
                        when={t('detail.spanNote')}
                    />
                )}
            </div>

            {/* Shifted with the series when the sea-level frame is showing, or the
                day's extremes would be quoted in a different frame than the chart
                right under them. */}
            <TodayExtremes
                max={shiftExtreme(stats?.maxPressure)} min={shiftExtreme(stats?.minPressure)}
                unit="hPa" digits={1}
            />

            <h3 className="metric-section">{t('detail.seriesTitle')}</h3>
            <div className="metric-chart">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="detailPressFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={PRESSURE} stopOpacity={0.35} />
                                <stop offset="95%" stopColor={PRESSURE} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff14" />
                        <XAxis
                            dataKey="uniqueTime" stroke="#ffffff66" tick={{ fontSize: 11 }}
                            minTickGap={axisTickGap} tickFormatter={axisTimeFormat}
                        />
                        <YAxis
                            stroke="#ffffff66" tick={{ fontSize: 11 }} width={56} domain={domain}
                            tickFormatter={(v) => formatFixed(v, 0)}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' }}
                            itemStyle={{ color: '#e4e4e7' }}
                            labelStyle={{ color: '#a1a1aa' }}
                            labelFormatter={tooltipTimeFormat}
                            formatter={(value) => [`${formatFixed(value, 2)} hPa`, t('detail.pressure.series')]}
                        />
                        <Area
                            type="monotone" dataKey="pressure" name={t('detail.pressure.series')}
                            stroke={PRESSURE} strokeWidth={2} fill="url(#detailPressFill)"
                            dot={false} isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/*
              The tide, and the reason this view exists at all. It is plotted from
              each hour's deviation from its own day's mean rather than from
              absolute readings: over a fortnight the synoptic swings run to
              27 hPa against the tide's 3, so an absolute profile would mostly
              measure which days landed in the window.

              This is the same signal the card's tendency badge has subtracted out
              of it before banding — computed the same way here so the chart and
              the badge cannot tell different stories.
            */}
            <h3 className="metric-section">{t('detail.pressure.tideTitle')}</h3>
            <ProfileChart
                profile={tide} hours={hours} color={PRESSURE} unit="" digits={2} tickDigits={1}
                intro={t('detail.pressure.tideIntro')}
                requireRange={false}
            />
        </>
    );
};

export default PressureDetail;
