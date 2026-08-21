import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ArrowDown, ArrowUp, CloudFog, Droplets, Snowflake, Wind } from 'lucide-react';
import { formatDayTime, formatFixed } from '../../utils/timezone';
import { seriesStats } from './seriesStats';
import StatTile from './StatTile';
import ProfileChart from './ProfileChart';

const DEW = '#69db7c';
const TEMP = '#ff6b6b';
const COLD = '#4dabf7';
const GAP = '#a1a1aa';

/*
  The bands for how close the air is to saturating, and both edges came off this
  station's own fortnight rather than a textbook.

  The textbook line for fog is a spread under 1 °C. Here that fires 0.0 % of the
  time — the spread never went below 1.31 °C in two weeks, which is the same fact
  the humidity view sees from the other side when it tops out at 91 %. A
  threshold that can never fire is a decoration, so the interesting line is
  higher: at 2 °C the air is as close to saturating as it gets here, 20 % of the
  time. 5 °C splits off the merely damp, at 61 %.

  Quartiles for scale: p25 2.23, p50 3.56, p75 8.70, max 23.49.
*/
const NEAR_C = 2;
const DAMP_C = 5;

/*
  Below freezing, what forms when a surface reaches the dew point is frost rather
  than dew. It happens 48.3 % of the time here, so it is not an edge case — it is
  half the readings, and the single most consequential thing this number says if
  anything living is nearby.
*/
const FROST_C = 0;

const marginBand = (spread) => {
    if (spread == null) return null;
    if (spread <= NEAR_C) return { key: 'near', color: COLD, Icon: CloudFog };
    if (spread <= DAMP_C) return { key: 'damp', color: DEW, Icon: Droplets };
    return { key: 'dry', color: '#a1a1aa', Icon: Wind };
};

/**
 * The expanded view of the dew point.
 *
 * This one exists because the reading is nearly unreadable alone. "3,5 °C" says
 * almost nothing until you know the air temperature next to it — the pair is the
 * information, and the gap between them is what predicts dew, fog and frost. So
 * the chart here is not the dew point: it is the dew point *and* the air, with
 * the space between them shaded, which is the plot every meteorologist draws for
 * exactly this reason.
 *
 * Both series are in °C, which is what makes one shared axis honest here. The
 * enclosure panel splits temperature and humidity into stacked charts precisely
 * because those two are not, and a second scale would invite the reader to see
 * crossings that are artefacts of where each was pinned. Two quantities in the
 * same unit have no such problem: when these lines converge, the air really is
 * approaching saturation.
 */
const DewPointDetail = ({
    history, hours, axisTimeFormat, tooltipTimeFormat, axisTickGap,
}) => {
    const { t } = useTranslation('dashboard');
    const s = useMemo(() => seriesStats(history, 'dewPoint'), [history]);

    /*
      The shaded band is folded in rather than drawn from two keys, because
      recharts fills an Area between the two ends of a [low, high] pair and there
      is no primitive for "the space between these other two series".

      Points missing either half are left with no band rather than a half-built
      one: the backend omits the dew point when the sensor said nothing, and
      pairing that gap with a real temperature would shade a spread nobody
      measured.
    */
    const data = useMemo(() => (history ?? []).map((p) => ({
        ...p,
        gap: (typeof p.dewPoint === 'number' && typeof p.temperature === 'number')
            ? [p.dewPoint, p.temperature]
            : null,
        spread: (typeof p.dewPoint === 'number' && typeof p.temperature === 'number')
            ? p.temperature - p.dewPoint
            : null,
    })), [history]);

    // Counted here rather than through the shared fractionAtOrAbove, which only
    // knows how to look upwards: both of these ask about a floor, and the spread
    // is not even a field on the point until this view derives it.
    const nearFraction = useMemo(
        () => {
            const pts = data.filter((p) => p.spread != null);
            if (!pts.length) return null;
            return pts.filter((p) => p.spread <= NEAR_C).length / pts.length;
        },
        [data],
    );
    const frostFraction = useMemo(
        () => {
            const pts = (history ?? []).filter((p) => typeof p.dewPoint === 'number');
            if (!pts.length) return null;
            return pts.filter((p) => p.dewPoint < FROST_C).length / pts.length;
        },
        [history],
    );

    if (!s) return <p className="metric-empty">{t('detail.noData')}</p>;

    // The last point that carries both halves, not simply the last point: a
    // window can end on a sample whose dew point is missing, and the reader would
    // rather see the most recent real margin than nothing.
    const latest = [...data].reverse().find((p) => p.spread != null);
    const band = marginBand(latest?.spread);

    return (
        <>
            {band && (
                /* Icon, colour and words all carry the state, never colour alone —
                   the green and amber of this dashboard separate by only ΔE 6.8
                   under protanopia. */
                <div className="metric-today" style={{ color: band.color }}>
                    <band.Icon size={16} aria-hidden="true" />
                    <span>
                        {t(`detail.dew.margin.${band.key}`, { margin: formatFixed(latest.spread, 1) })}
                    </span>
                </div>
            )}

            <div className="metric-stats">
                <StatTile
                    label={t('detail.max')} value={formatFixed(s.maxValue, 1)} unit="°C"
                    when={formatDayTime(s.max.uniqueTime)} icon={ArrowUp} color={DEW}
                />
                <StatTile
                    label={t('detail.min')} value={formatFixed(s.minValue, 1)} unit="°C"
                    when={formatDayTime(s.min.uniqueTime)} icon={ArrowDown} color={COLD}
                />
                <StatTile label={t('detail.mean')} value={formatFixed(s.mean, 1)} unit="°C" />
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
                {nearFraction != null && (
                    <StatTile
                        label={t('detail.dew.near')} value={formatFixed(nearFraction * 100, 0)} unit="%"
                        when={t('detail.dew.nearNote', { margin: NEAR_C })}
                        icon={CloudFog} color={COLD}
                    />
                )}
                {frostFraction != null && (
                    <StatTile
                        label={t('detail.dew.frost')} value={formatFixed(frostFraction * 100, 0)} unit="%"
                        when={t('detail.dew.frostNote')}
                        icon={Snowflake} color={COLD}
                    />
                )}
            </div>

            <h3 className="metric-section">{t('detail.dew.pairTitle')}</h3>
            <p className="metric-note">{t('detail.dew.pairIntro')}</p>
            <div className="metric-chart">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
                            formatter={(value, name) => [
                                Array.isArray(value)
                                    ? `${formatFixed(value[1] - value[0], 1)} °C`
                                    : `${formatFixed(value, 2)} °C`,
                                name,
                            ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                        {/* Freezing, where what forms stops being dew and starts
                            being frost. Drawn plainly rather than coloured, because
                            it is a fact about water and not a state of this
                            station. */}
                        <ReferenceLine y={FROST_C} stroke="#ffffff44" strokeDasharray="2 4" />
                        {/* Neutral ink for the gap on purpose: it belongs to
                            neither line, and tinting it with either would read as
                            that series having a thickness. */}
                        <Area
                            type="monotone" dataKey="gap" name={t('detail.dew.gap')}
                            stroke="none" fill={GAP} fillOpacity={0.14}
                            legendType="rect" connectNulls={false} isAnimationActive={false}
                        />
                        {/* Weight and dash separate these as well as hue, so the
                            pair stays readable for a reader who cannot tell the two
                            hues apart — red and green being precisely the pair that
                            protanopia collapses. */}
                        <Line
                            type="monotone" dataKey="temperature" name={t('detail.temp.series')}
                            stroke={TEMP} strokeWidth={2.2} dot={false} isAnimationActive={false}
                        />
                        <Line
                            type="monotone" dataKey="dewPoint" name={t('detail.dew.series')}
                            stroke={DEW} strokeWidth={2} strokeDasharray="5 4"
                            dot={false} connectNulls isAnimationActive={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <h3 className="metric-section">{t('detail.profileTitle')}</h3>
            <ProfileChart profile={s.profile} hours={hours} color={DEW} unit="°" digits={1} />
        </>
    );
};

export default DewPointDetail;
