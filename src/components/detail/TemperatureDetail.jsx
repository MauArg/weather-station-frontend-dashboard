import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ComposedChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatDayTime, formatFixed, formatNumber } from '../../utils/timezone';
import { seriesStats } from './seriesStats';
import StatTile from './StatTile';
import ProfileChart from './ProfileChart';
import TodayExtremes from './TodayExtremes';

const TEMP = '#ff6b6b';
const COLD = '#4dabf7';

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
    const s = useMemo(() => seriesStats(history, 'temperature'), [history]);

    if (!s) return <p className="metric-empty">{t('detail.noData')}</p>;

    // Against the live reading, not against the end of the series: the card next
    // to it shows the live one, and two figures that disagree by a poll interval
    // read as a bug.
    const ref = stats?.temp24hAgo;
    const dayAgo = ref && typeof currentData?.temperature === 'number'
        ? currentData.temperature - ref.value
        : null;

    return (
        <>
            <div className="metric-stats">
                <StatTile
                    label={t('detail.max')} value={formatFixed(s.maxValue, 1)} unit="°C"
                    when={formatDayTime(s.max.uniqueTime)} icon={ArrowUp} color={TEMP}
                />
                <StatTile
                    label={t('detail.min')} value={formatFixed(s.minValue, 1)} unit="°C"
                    when={formatDayTime(s.min.uniqueTime)} icon={ArrowDown} color={COLD}
                />
                <StatTile label={t('detail.mean')} value={formatFixed(s.mean, 1)} unit="°C" />
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

                  Two whole days rather than one, because a mean over a single day
                  is that day, and "averaged over 1 day" invites the reader to
                  trust it as a typical value.
                */}
                {s.completeDays >= 2 ? (
                    <StatTile
                        label={t('detail.swing')} value={formatFixed(s.meanSwing, 1)} unit="°C"
                        when={t('detail.swingOver', { count: s.completeDays })}
                    />
                ) : (
                    <StatTile
                        label={t('detail.span')} value={formatFixed(s.windowSwing, 1)} unit="°C"
                        when={t('detail.spanNote')}
                    />
                )}
                {dayAgo != null && (
                    <StatTile
                        label={t('detail.temp.dayAgo')}
                        value={formatNumber(dayAgo, { digits: 1, minDigits: 1, sign: 'always' })}
                        unit="°C"
                        when={t('detail.temp.dayAgoRef', { temp: formatFixed(ref.value, 1) })}
                    />
                )}
            </div>

            {/*
              Today's extremes, on their own line below the window's. They are the
              figures the card used to carry and they answer a different question
              — see TodayExtremes for why they are not tiles.
            */}
            <TodayExtremes max={stats?.maxTemp} min={stats?.minTemp} unit="°C" digits={1} />

            <h3 className="metric-section">{t('detail.seriesTitle')}</h3>
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
                        {/* The two extremes are marked rather than left to be hunted
                            for: the stat block above names them, and a number you
                            cannot find on the chart it came from is a claim rather
                            than a reading. */}
                        <ReferenceLine y={s.maxValue} stroke={TEMP} strokeDasharray="4 4" strokeOpacity={0.6} />
                        <ReferenceLine y={s.minValue} stroke={COLD} strokeDasharray="4 4" strokeOpacity={0.6} />
                        <Area
                            type="monotone" dataKey="temperature" name={t('detail.temp.series')}
                            stroke={TEMP} strokeWidth={2} fill="url(#detailTempFill)"
                            dot={false} isAnimationActive={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <h3 className="metric-section">{t('detail.profileTitle')}</h3>
            <ProfileChart profile={s.profile} hours={hours} color={TEMP} unit="°" digits={1} />
        </>
    );
};

export default TemperatureDetail;
