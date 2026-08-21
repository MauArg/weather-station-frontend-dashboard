import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ArrowDown, ArrowUp, Droplets } from 'lucide-react';
import { formatDayTime, formatFixed } from '../../utils/timezone';
import { seriesStats, fractionAtOrAbove } from './seriesStats';
import StatTile from './StatTile';
import ProfileChart from './ProfileChart';
import TodayExtremes from './TodayExtremes';

const HUMIDITY = '#4dabf7';
const DRY = '#facc15';

/*
  The line above which the air counts as damp, and it was measured rather than
  picked from a table.

  Over 14 days this station reads a median of 77.6 % with a p75 of 84.8 %, so 80
  sits between them and splits the window near 45/55. That balance is the whole
  point: a threshold almost never crossed, or almost always, tells the reader
  nothing they could not have guessed. At 80 the figure moves with the weather.

  For reference on the rest of the distribution: the fortnight ran 20.4 % to
  91.1 %, and the approach to that ceiling is smooth and every value distinct —
  so it is a real local maximum, not a sensor clipping.
*/
const DAMP_PCT = 80;

/**
 * The expanded view of the humidity reading.
 *
 * Same shape as the temperature view on purpose. The two readings answer the
 * same questions and a reader who has opened one should not have to relearn the
 * layout to read the other; what differs is the axis, and the one figure that
 * only means something for humidity.
 */
const HumidityDetail = ({
    history, stats, hours, axisTimeFormat, tooltipTimeFormat, axisTickGap,
}) => {
    const { t } = useTranslation('dashboard');
    const s = useMemo(() => seriesStats(history, 'humidity'), [history]);
    const damp = useMemo(() => fractionAtOrAbove(history, 'humidity', DAMP_PCT), [history]);

    if (!s) return <p className="metric-empty">{t('detail.noData')}</p>;

    /*
      Padded around the data rather than pinned to 0-100. Relative humidity has
      real bounds, which is the argument for showing them — but this station has
      never left 20-91 %, and an axis anchored at both ends spends a third of its
      height on states it cannot reach while flattening the movement that is
      actually there. The same reasoning the enclosure chart already follows.

      Clamped at the ends anyway, because a padded axis that runs past 100 % would
      be drawing a region no reading can occupy.
    */
    const domain = [
        Math.max(0, Math.floor(s.minValue / 5) * 5 - 5),
        Math.min(100, Math.ceil(s.maxValue / 5) * 5 + 5),
    ];

    return (
        <>
            <div className="metric-stats">
                <StatTile
                    label={t('detail.max')} value={formatFixed(s.maxValue, 1)} unit="%"
                    when={formatDayTime(s.max.uniqueTime)} icon={ArrowUp} color={HUMIDITY}
                />
                <StatTile
                    label={t('detail.min')} value={formatFixed(s.minValue, 1)} unit="%"
                    when={formatDayTime(s.min.uniqueTime)} icon={ArrowDown} color={DRY}
                />
                <StatTile label={t('detail.mean')} value={formatFixed(s.mean, 1)} unit="%" />
                {s.completeDays >= 2 ? (
                    <StatTile
                        label={t('detail.swing')} value={formatFixed(s.meanSwing, 1)} unit="%"
                        when={t('detail.swingOver', { count: s.completeDays })}
                    />
                ) : (
                    <StatTile
                        label={t('detail.span')} value={formatFixed(s.windowSwing, 1)} unit="%"
                        when={t('detail.spanNote')}
                    />
                )}
                {damp != null && (
                    /*
                      How long the air sat damp, which is the one question here
                      that the curve above genuinely cannot answer: a series that
                      crosses a line forty times does not tell you how much of the
                      window it spent on either side of it.
                    */
                    <StatTile
                        label={t('detail.humidity.wet')} value={formatFixed(damp * 100, 0)} unit="%"
                        when={t('detail.humidity.wetNote', { threshold: DAMP_PCT })}
                        icon={Droplets} color={HUMIDITY}
                    />
                )}
            </div>

            {/* Same reasoning as the temperature view: these run from local
                midnight and the window extremes do not. */}
            <TodayExtremes max={stats?.maxHumidity} min={stats?.minHumidity} unit="%" digits={1} />

            <h3 className="metric-section">{t('detail.seriesTitle')}</h3>
            <div className="metric-chart">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="detailHumFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={HUMIDITY} stopOpacity={0.4} />
                                <stop offset="95%" stopColor={HUMIDITY} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff14" />
                        <XAxis
                            dataKey="uniqueTime" stroke="#ffffff66" tick={{ fontSize: 11 }}
                            minTickGap={axisTickGap} tickFormatter={axisTimeFormat}
                        />
                        <YAxis
                            stroke="#ffffff66" tick={{ fontSize: 11 }} width={52} domain={domain}
                            tickFormatter={(v) => `${formatFixed(v, 0)}%`}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' }}
                            itemStyle={{ color: '#e4e4e7' }}
                            labelStyle={{ color: '#a1a1aa' }}
                            labelFormatter={tooltipTimeFormat}
                            formatter={(value) => [`${formatFixed(value, 1)} %`, t('detail.humidity.series')]}
                        />
                        {/* The damp line drawn where the tile counts it, so the
                            percentage above is something the reader can see rather
                            than a figure they have to take on faith. Only when the
                            axis actually contains it — a dry window would otherwise
                            get a line pinned to its edge, which reads as a reading. */}
                        {domain[0] < DAMP_PCT && domain[1] > DAMP_PCT && (
                            <ReferenceLine
                                y={DAMP_PCT} stroke={HUMIDITY} strokeDasharray="4 4" strokeOpacity={0.5}
                                label={{
                                    value: `${DAMP_PCT}%`, position: 'insideTopRight',
                                    fill: '#a1a1aa', fontSize: 11,
                                }}
                            />
                        )}
                        <Area
                            type="monotone" dataKey="humidity" name={t('detail.humidity.series')}
                            stroke={HUMIDITY} strokeWidth={2} fill="url(#detailHumFill)"
                            dot={false} isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <h3 className="metric-section">{t('detail.profileTitle')}</h3>
            <ProfileChart profile={s.profile} hours={hours} color={HUMIDITY} unit="%" digits={1} />
        </>
    );
};

export default HumidityDetail;
