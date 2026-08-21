import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart } from 'recharts';
import { Thermometer, Droplets, Gauge, CloudRain, Battery, BatteryCharging, CheckCircle2, Moon, AlertTriangle, HelpCircle, Sun, Zap, Loader2, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Minus } from 'lucide-react';
import StatCard from './StatCard';
import MetricModal from './MetricModal';
import TemperatureDetail from './detail/TemperatureDetail';
import HumidityDetail from './detail/HumidityDetail';
import ChartCrosshair, { CROSSHAIR_STROKE, CROSSHAIR_WIDTH, CROSSHAIR_DASH } from './ChartCrosshair';
import { getRealTimeData, getDailyStats, getRecentHistory } from '../services/ApiService';
import { formatTime, formatDayTime, formatDay, formatNumber, formatFixed } from '../utils/timezone';
import { useNarrowLayout } from '../hooks/useNarrowLayout';
import toast from 'react-hot-toast';

/*
  The ranges offered by the selector, in hours, with the label each one wears.
  Hours stay the unit on the wire because that is what the API takes; the label
  switches to days past 24 h because "336h" is a number nobody holds in their
  head. The list is the single source of truth for both.

  Nothing above 24 h needed a backend change: the handler accepts any positive
  `hours`, and the Flux query already aggregates into 15-minute windows, so 14 d
  is 1344 points rather than the raw sample count. Measured against the Pi: 673
  points and 3.7 s for 7 d, 1344 points and 4.7 s for 14 d. That wait is the
  reason the charts got their own loading state — see below.
*/
/*
  The temperature trend, keyed by the band the backend sends — see
  internal/temptrend. The scale is diverging on purpose: blue for cooling, red
  for warming, neutral grey in the middle. Grafana, where this indicator came
  from, uses green for steady, and green reads as "good"; a temperature trend is
  neither good nor bad, so a status palette would be saying something the data
  does not.

  Doubling the chevron carries the "fast" bands without needing a second colour
  cue, which matters because the word is what actually communicates here — the
  colour never does it alone, the same rule the service view follows.
*/
const TREND_UI = {
    coolingFast: { color: '#4dabf7', Icon: ChevronsDown },
    cooling: { color: '#74c0fc', Icon: ChevronDown },
    steady: { color: '#a1a1aa', Icon: Minus },
    warming: { color: '#ffa94d', Icon: ChevronUp },
    warmingFast: { color: '#ff6b6b', Icon: ChevronsUp },
};

const RANGES = [
    { hours: 6, label: '6h' },
    { hours: 24, label: '24h' },
    { hours: 48, label: '2d' },
    { hours: 72, label: '3d' },
    { hours: 168, label: '7d' },
    { hours: 336, label: '14d' },
];

const Dashboard = () => {
    const { t } = useTranslation('dashboard');

    /*
      The two full-width charts carry desktop gutters — 30px of margin on each
      side plus fixed axis widths — that are a rounding error on a 1200px card
      and half the card on a phone. Measured at a 390px viewport: the stacked
      cards are all 325px wide, but the plot area came out 255px on the
      temperature and humidity charts against 185px on the energy one and 125px
      on the thermal-lag one, which has axes on both sides. So the two charts
      the eye reads as "the wide ones" were the narrowest of the four.

      Below the breakpoint the gutters collapse and the axes size themselves to
      their labels. Desktop keeps the numbers it had.
    */
    const narrow = useNarrowLayout();
    const wideChartMargin = { right: narrow ? 10 : 30, left: narrow ? 0 : 30 };

    /*
      Two formatters, and which one a quantity gets says something about the
      quantity rather than being a style choice.

      formatValue is for the ones that are whole numbers by nature — the mW the
      node reports as integers — where a decimal place would invent precision the
      instrument never had.

      formatReading is for the sensors, whose precision is fixed and is part of
      what is being shown. Without the trailing zeros a reading loses a digit
      whenever it lands on a round value: the headline goes from 14,04 °C to
      14 °C, changes width mid-glance, and reads for a moment as a different kind
      of number. The footer had it worse, with 19,2 and 2,54 sitting in the same
      row of the same card.
    */
    const formatValue = (val) => formatNumber(val);
    const formatReading = (val) => formatFixed(val, 2);

    const [currentData, setCurrentData] = useState(null);
    const [history, setHistory] = useState([]);
    const [stats, setStats] = useState(null);
    const [timeRange, setTimeRange] = useState(24); // hours; see RANGES
    /*
      Which headline reading is expanded, or null. One at a time by construction
      — the detail view is a modal, so a second one could not be seen anyway, and
      a single value means closing is always the same operation.
    */
    const [openMetric, setOpenMetric] = useState(null);

    /*
      Past a day a bare HH:MM repeats itself once per day on the axis and in the
      tooltip, which is the one thing a multi-day chart must not do. Past about
      three days the hour stops meaning anything on a *tick* as well, so the
      axis drops to a bare date while the tooltip keeps the full instant — a
      tick labels a region, a tooltip labels a point.

      Measured off the loaded series rather than off `timeRange`, because the
      two disagree for the seconds a long range takes to answer: the selection
      flips immediately while the previous range's curve is still on screen, and
      driving the labels off the selection relabels that curve with dates it
      does not span — a day of data captioned as a fortnight. The axis describes
      what is drawn, so it has to be derived from what is drawn.
    */
    const spanHours = history.length > 1
        ? (new Date(history[history.length - 1].uniqueTime) - new Date(history[0].uniqueTime)) / 3600000
        : 0;
    const isMultiDay = spanHours >= 36;
    const axisTimeFormat = spanHours >= 144 ? formatDay : isMultiDay ? formatDayTime : formatTime;
    const tooltipTimeFormat = isMultiDay ? formatDayTime : formatTime;

    // Wider labels need more room before recharts is allowed to place the next
    // tick, or the dates collide into an unreadable smear on a phone.
    const axisTickGap = isMultiDay ? 60 : 30;

    // Sea-level by default: ~1014 hPa is what a barometric reading means to anyone
    // reading it, while the station's ~923 hPa only parses if you already know the
    // sensor sits several hundred metres up. Persisted because it is a preference
    // rather than a mode — switching to the raw figure is a rare, deliberate act,
    // and having it silently revert on the next reload would be its own small bug.
    const [pressureMode, setPressureMode] = useState(() => {
        try {
            return localStorage.getItem('pressureMode') === 'station' ? 'station' : 'qnh';
        } catch {
            return 'qnh'; // storage can throw when cookies are blocked
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('pressureMode', pressureMode);
        } catch {
            // Not worth surfacing: the choice just does not survive a reload.
        }
    }, [pressureMode]);

    /*
      Only the charts wait on a range change, not the whole page.

      This used to be one `isLoading` that gated the entire dashboard, which was
      invisible while every range answered in well under a second. At 7 d and
      14 d it is several seconds, and blanking the cards, the energy state and
      the extremes — none of which depend on the range — to redraw them
      identically reads as the page having crashed and come back.

      The stale curve stays on screen, dimmed, while the new one loads. Showing
      the previous range's data for a moment is honest here: it is real data
      that was just correct, and the spinner over it says it is being replaced.
    */
    const [isHistoryLoading, setIsHistoryLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const loadData = async () => {
            setIsHistoryLoading(true);
            try {
                const [current, dailyStats, historyData] = await Promise.all([
                    getRealTimeData(),
                    getDailyStats(),
                    getRecentHistory(timeRange)
                ]);
                
                if (isMounted) {
                    setCurrentData(current);
                    setStats(dailyStats);
                    setHistory(historyData);
                }
            } catch (error) {
                console.error(error);
                if (isMounted) toast.error(t('toast.loadFailed'));
            } finally {
                if (isMounted) setIsHistoryLoading(false);
            }
        };

        loadData();

        const interval = setInterval(async () => {
            try {
                const newData = await getRealTimeData();
                if (!isMounted) return;
                setCurrentData(newData);
            } catch (error) {
                console.error("Interval fetch error:", error);
            }
        }, 3000);

        /*
          Today's extremes are re-read on their own clock, because they change on
          their own: a new high is set by a reading arriving, not by anything the
          reader does. They used to be fetched only by the effect above — on the
          first paint and on a range change — so on a dashboard left open they
          stayed frozen at whatever the day had reached when the tab was opened,
          and only a reload moved them. That read as a bug precisely because
          everything around them was ticking.

          A minute rather than the 3 s of the live poll, because this one costs a
          query: the backend answers it by scanning every raw point since local
          midnight, unaggregated — about 110 ms by mid-afternoon and growing
          through the day. At 3 s that is a full day's scan running continuously
          for a figure that cannot move faster than telemetry arrives, which is
          once a minute.

          A minute of staleness used to be invisible because the cards folded the
          live reading into the pair before drawing them. That fold is gone with
          the cards' footers: today's extremes now live in the detail views, which
          are open only while someone is looking at them, and a minute-old high in
          a view you deliberately opened reads as what it is. What still has no
          cheaper answer is the midnight reset — extending a maximum is something
          a live reading can do on its own, dropping back to a new day's is not —
          and that is what this interval is really for.
        */
        const statsInterval = setInterval(async () => {
            try {
                const dailyStats = await getDailyStats();
                if (!isMounted) return;
                setStats(dailyStats);
            } catch (error) {
                console.error("Stats interval fetch error:", error);
            }
        }, 60 * 1000);

        // Refresh history graph data every 5 minutes to keep it up to date
        // without distorting the curve with unaggregated real-time points
        const historyInterval = setInterval(async () => {
            try {
                const historyData = await getRecentHistory(timeRange);
                if (!isMounted) return;
                setHistory(historyData);
            } catch (error) {
                console.error("History interval fetch error:", error);
            }
        }, 5 * 60 * 1000);

        return () => {
            isMounted = false;
            clearInterval(interval);
            clearInterval(statsInterval);
            clearInterval(historyInterval);
        };
        // `t` is intentionally out of the dependency list: it is only read inside
        // the error branch, and adding it would re-fetch every series on a
        // language change. The toast that follows a failed load is transient
        // anyway — it is gone long before anyone could switch languages.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeRange]); // Re-run when timeRange changes

    // The full-page loader is now only for the first paint, when there is
    // genuinely nothing to show. A range change keeps everything on screen.
    if (!currentData || !stats) {
        return (
            <div className="loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }}>
                <Loader2 className="animate-spin" size={48} color="#4dabf7" />
                <p>{t('loading')}</p>
            </div>
        );
    }

    // How the pack's voltage is trending, phrased for someone who is not going to
    // do the arithmetic. Below ~5 mV/h the trend is inside the estimator's own
    // noise, so it is reported as holding rather than as a direction.
    const driftPhrase = (vh) => {
        if (vh == null) return null;
        const mvh = vh * 1000;
        if (Math.abs(mvh) < 5) return t('drift.steady');
        return t(mvh > 0 ? 'drift.rising' : 'drift.falling', { mvh: Math.abs(mvh).toFixed(0) });
    };

    // The scenario, not a number. `unknown` is a real answer here: the trend comes
    // from the bridge's in-memory ring, which starts empty when the backend
    // restarts and needs about an hour before it can say anything. Showing a
    // guess in the meantime would defeat the point of the change.
    //
    // Only the presentation lives here now — the wording moved to the dashboard
    // dictionary, keyed by the same state names the backend sends. Worth noting
    // for `charging`: it says "covering" rather than "delivering more than it
    // consumes" because the state includes the flat-voltage case where input ≈
    // output. Claiming a surplus would bring back the comparison this gauge
    // stopped making, and would clash with the drift phrase saying "steady".
    //
    // `surplus` replaced `full`, which the backend no longer sends. Both named
    // the same situation — pack topped off, charger turning energy away — but
    // `full` was decided from a single sample of a process that cycles every few
    // minutes, so this card flipped between it and `charging` 136 times per
    // daylight hour. An older backend still sending `full` falls through to
    // `unknown` below, which is the same degradation this line already handles.
    const ENERGY_UI = {
        charging: { color: '#4ade80', Icon: BatteryCharging, pulse: 'pulse-animation-positive' },
        surplus: { color: '#4ade80', Icon: CheckCircle2, pulse: '' },
        discharging: { color: '#a1a1aa', Icon: Moon, pulse: '' },
        deficit: { color: '#f87171', Icon: AlertTriangle, pulse: 'pulse-animation-negative' },
        unknown: { color: '#71717a', Icon: HelpCircle, pulse: '' },
    };

    // Joined with "·" rather than as another sentence: the drift phrase isn't
    // a sentence —it starts with a symbol or in lowercase— and appending it
    // after the period read as "…not accepting more charge. steady over the
    // last 2 h".
    const stateKey = ENERGY_UI[currentData.energyState] ? currentData.energyState : 'unknown';
    const detail = t(`energy.state.${stateKey}.detail`);
    const drift = driftPhrase(currentData.batteryDriftVH);
    const energyUi = {
        ...ENERGY_UI[stateKey],
        label: t(`energy.state.${stateKey}.label`),
        detail: drift ? `${detail.replace(/\.$/, '')} · ${drift}` : detail,
    };

    // Only offer the switch when the node actually reported QNH. The field is left
    // out of the payload when the BMP085 read fails, and a card that can be
    // flipped into a blank reading is worse than one that cannot be flipped.
    //
    // Grouping is off for these two on purpose — see formatNumber in
    // utils/timezone.js for why a four-digit pressure must not carry a separator.
    const formatPressure = (val) => formatNumber(val, { digits: 2, minDigits: 2, grouping: false });

    const pressureVariants = currentData.pressureQnh == null ? null : [
        { key: 'qnh', value: formatPressure(currentData.pressureQnh), unit: 'hPa', caption: t('pressure.qnh') },
        { key: 'station', value: formatPressure(currentData.pressure), unit: 'hPa', caption: t('pressure.station') },
    ];

    /*
      Day boundaries, drawn as vertical rules so an overnight curve can be read
      against the calendar. They stop above 3 days: at 7 d and 14 d they stop
      being landmarks and become a picket fence across the plot, and the axis
      already carries the date by then, which is the job they were doing.

      Gated on the span of the loaded data for the same reason as the axis
      formatters above.
    */
    const midnightPoints = [];
    if (history.length > 0 && spanHours <= 96) {
        for (let i = 1; i < history.length; i++) {
            if (!history[i-1].uniqueTime || !history[i].uniqueTime) continue;
            const prevDate = new Date(history[i-1].uniqueTime);
            const currDate = new Date(history[i].uniqueTime);
            if (prevDate.getDate() !== currDate.getDate()) {
                midnightPoints.push(history[i].uniqueTime);
            }
        }
    }

    /*
      Today's high and low, shown inside the card for the quantity they belong
      to rather than in their own row at the foot of the page.

      They used to sit below the last chart, which is the furthest possible
      point from the number they qualify — nobody scrolls past four charts to
      find out whether 6° is a cold moment in a mild day or the mild moment in a
      cold one. Read under the current reading, they are the context that makes
      it mean something, which is the arrangement every weather app converged on.

      They do not contradict the "live data" heading above them, because they
      are not offered as a separate claim: the card is about temperature, and
      these say where today's temperature has been. The `today` in the label is
      what keeps that honest, and it is why the label is not just "max".

      Temperature and humidity only. The API also returns maxPressure/minPressure
      but they are taken over `pressure_hpa`, the raw station reading, while this
      card shows sea-level QNH by default — about 90 hPa apart. Putting "930,84
      hPa" under a headline of "1016,39 hPa" would read as a broken card, and
      rescaling the extremes by the current offset would be a guess: the offset
      moves with temperature through the day, by enough to matter against a
      6 hPa spread, and the *times* of the two series' extremes need not agree.
      The honest fix is a `pressure_qnh` pair from the backend, which already has
      that field. Dew point has no extremes at all — it is derived.
    */
    /*
      Which way the air is going, under the reading it qualifies.

      Three states, not two. An absent `tempTrend` is a backend too old to have
      this at all and renders nothing — the same additive degradation the version
      badge and the log panel already rely on. `unknown` is this backend saying
      the ring is still filling, which takes about half an hour after a restart,
      and that gets said out loud rather than hidden: the alternative is
      inventing a trend from a handful of samples, which is what the Grafana
      panel this replaces does.

      The rate carries its sign, and the parentheses are not decoration.

      Signed because inside the steady band the word says "Estable" and the icon
      is a flat dash: neither of them carries a direction, so `(+0,3 °C/h)` and
      `(-0,3 °C/h)` are the same reading without it — a night that is warming
      back up against one still cooling. There the sign is not repeating
      anything, it is the only place that information lives. In the other four
      bands it does repeat the word, and that is fine: it is the rule this
      dashboard already applies to colour, which never communicates alone.

      Parenthesised because the separator that used to sit there was a middle
      dot, and at this size "· 0,13" reads as a mangled "-0,13" — Mau read it
      that way. Worse than looking odd: taken for a sign it inverts the meaning,
      turning "Calentando · 1,8" into a fall. A bracket cannot be mistaken for
      one in any position, and it says what the dot was trying to say — this is
      the evidence for the word in front of it.
    */
    const temperatureTrend = (() => {
        const band = currentData.tempTrend;
        if (!band) return null;

        const ui = TREND_UI[band];
        /*
          The two tooltips say different things on purpose. A band is a reading
          that needs its scale explained — "Steady" means nothing until you know
          what it is steady against — while `unknown` is not a reading at all,
          and the only useful thing to say about it is that it passes on its own.
          Without that second one "Measuring…" looks like something stuck.
        */
        if (!ui) return <span className="stat-note-muted" title={t('trend.unknownTip')}>{t('trend.unknown')}</span>;

        const { color, Icon } = ui;
        const rate = currentData.tempDriftCPerH;
        return (
            <span className="stat-trend" style={{ color }} title={t('trend.tip')}>
                <Icon size={16} aria-hidden="true" />
                {t(`trend.${band}`)}
                {rate != null && (
                    <span className="stat-trend-rate">({formatNumber(rate, { sign: 'always' })} °C/h)</span>
                )}
            </span>
        );
    })();

    /*
      One selector, rendered in two places. The detail views read the same
      `history` the charts below draw from, so giving a modal its own range
      control would mean either a second fetch of the same window or two
      controls that silently disagree about which one is showing. Sharing the
      state means changing the window anywhere changes it everywhere, which is
      also the only answer that survives the modal being closed.
    */
    const rangeSelector = (
        <div className="time-controls">
            {RANGES.map(({ hours, label }) => (
                <button
                    key={hours}
                    type="button"
                    className="time-range-btn"
                    aria-pressed={timeRange === hours}
                    onClick={() => setTimeRange(hours)}
                >
                    {label}
                </button>
            ))}
        </div>
    );

    return (
        <div className="dashboard-container">
            {/*
              The two sections are split by *when*, not by what they draw. This
              one is the current reading — the cards and the energy state, both
              of which describe the station right now. The one below is the same
              quantities over a window the reader picks, which is why it stopped
              being called live data once that window could be a fortnight.
            */}
            <div className="section-header">
                <h3>{t('section.liveData')}</h3>
            </div>

            {/* Top Stats Row */}
            <div className="stats-grid">
                <StatCard
                    title={t('card.temperature')}
                    value={formatReading(currentData.temperature)}
                    unit="°C"
                    icon={Thermometer}
                    color="#ff6b6b"
                    note={temperatureTrend}
                    /*
                      The extremes and the day-ago comparison used to live in a
                      footer here. They moved into the detail view: this card is
                      what you read without stopping, and a reading plus where it
                      is heading is all that survives that test. Everything that
                      asks you to compare two numbers wants room the card never
                      had.
                    */
                    onOpenDetail={() => setOpenMetric('temperature')}
                />
                <StatCard
                    title={t('card.humidity')}
                    value={formatReading(currentData.humidity)}
                    unit="%"
                    icon={Droplets}
                    color="#4dabf7"
                    onOpenDetail={() => setOpenMetric('humidity')}
                />
                <StatCard
                    title={t('card.pressure')}
                    value={formatPressure(currentData.pressure)}
                    unit="hPa"
                    icon={Gauge}
                    color="#ffd43b"
                    variants={pressureVariants}
                    activeVariant={pressureMode}
                    onCycleVariant={setPressureMode}
                    captionTip={t('pressure.tip')}
                />
                <StatCard
                    title={t('card.dewPoint')}
                    value={formatReading(currentData.dewPoint)}
                    unit="°C"
                    icon={CloudRain}
                    color="#69db7c"
                />
            </div>

            {/*
              Energy centrepiece.

              Headlines the *scenario*, not a power figure. The old version showed
              solarPower - systemConsumption, and those are not in the same units:
              the panel figure is continuous while the consumption one is measured
              during the ~3.6% of each cycle the node is awake. Over five days that
              subtraction read as a deficit through 56% of well-lit daytime, and
              none of those survived duty-correcting the consumption. The battery
              disagreed the whole time — its day-to-day drift was flat.

              The two power figures are still here, below, labelled as what they
              actually are. What is gone is the subtraction of one from the other.
            */}
            <div className={`energy-centerpiece ${energyUi.pulse}`}>
                <div className="energy-subtitle">{t('energy.title')}</div>
                <div className="energy-state-value" style={{ color: energyUi.color }}>
                    <energyUi.Icon size={56} aria-hidden="true" />
                    {energyUi.label}
                </div>
                <div className="energy-state-detail">{energyUi.detail}</div>
                <div className="energy-facts">
                    <div className="energy-fact" style={{ color: '#6ee7b7' }}>
                        <Battery size={20} aria-hidden="true" /> {t('energy.battery')} {formatFixed(currentData.batterySoc, 1)}%
                        {currentData.batteryVolts != null && ` · ${formatReading(currentData.batteryVolts)} V`}
                    </div>
                    <div className="energy-fact" style={{ color: '#fde047' }}>
                        <Sun size={20} aria-hidden="true" /> {t('energy.panel')} {formatValue(currentData.solarPower)} mW
                    </div>
                    <div
                        className="energy-fact"
                        style={{ color: '#a1a1aa', cursor: 'help' }}
                        title={t('energy.activeConsumptionTip')}
                    >
                        <Zap size={20} aria-hidden="true" /> {t('energy.activeConsumption')} {formatValue(currentData.systemConsumption)} mW
                    </div>
                </div>
            </div>

            {/* Main Graphs */}
            <div className="section-header">
                <h3>{t('section.trends')}</h3>
                {rangeSelector}
            </div>

            <div className={`charts-grid${isHistoryLoading ? ' is-loading' : ''}`}>
                {isHistoryLoading && (
                    <div className="charts-loading" role="status" aria-live="polite">
                        <Loader2 className="animate-spin" size={32} color="#4dabf7" />
                    </div>
                )}
                <div className="chart-card">
                    <h3>{t('chart.temperature')}</h3>
                    <ChartCrosshair>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history}>
                                <defs>
                                    <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ff6b6b" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#ff6b6b" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                <XAxis dataKey="uniqueTime" stroke="#ffffff80" tickFormatter={axisTimeFormat} tick={{ fontSize: 12 }} minTickGap={axisTickGap} />
                                <YAxis domain={['auto', 'auto']} stroke="#ffffff80" tickFormatter={val => `${val}°`} />
                                <Tooltip
                                    formatter={(value) => formatReading(value)}
                                    labelFormatter={tooltipTimeFormat}
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: CROSSHAIR_STROKE, strokeWidth: CROSSHAIR_WIDTH, strokeDasharray: `${CROSSHAIR_DASH} ${CROSSHAIR_DASH}` }}
                                />
                                {/* `name` is not decoration: without it the tooltip
                                    falls back to the dataKey and prints the raw
                                    field name, which is neither language. */}
                                <Area type="monotone" dataKey="temperature" name={t('series.temperature')} stroke="#ff6b6b" fillOpacity={1} fill="url(#colorTemp)" />
                                {midnightPoints.map(uniqueTime => (
                                    <ReferenceLine key={`mid-${uniqueTime}`} x={uniqueTime} stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </ChartCrosshair>
                </div>

                <div className="chart-card">
                    <h3>{t('chart.humidity')}</h3>
                    <ChartCrosshair>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history}>
                                <defs>
                                    <linearGradient id="colorHum" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#4dabf7" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#4dabf7" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                <XAxis dataKey="uniqueTime" stroke="#ffffff80" tickFormatter={axisTimeFormat} tick={{ fontSize: 12 }} minTickGap={axisTickGap} />
                                <YAxis domain={[0, 100]} stroke="#ffffff80" tickFormatter={val => `${val}%`} />
                                <Tooltip
                                    formatter={(value) => formatReading(value)}
                                    labelFormatter={tooltipTimeFormat}
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: CROSSHAIR_STROKE, strokeWidth: CROSSHAIR_WIDTH, strokeDasharray: `${CROSSHAIR_DASH} ${CROSSHAIR_DASH}` }}
                                />
                                <Area type="monotone" dataKey="humidity" name={t('series.humidity')} stroke="#4dabf7" fillOpacity={1} fill="url(#colorHum)" />
                                {midnightPoints.map(uniqueTime => (
                                    <ReferenceLine key={`mid-${uniqueTime}`} x={uniqueTime} stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </ChartCrosshair>
                </div>

                {/* Energy Chart: Production curve and consumption */}
                <div className="chart-card wide">
                    <h3>{t('chart.energy')}</h3>
                    <ChartCrosshair>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history} margin={{ top: 20, bottom: 5, ...wideChartMargin }}>
                                <defs>
                                    <linearGradient id="colorSolar" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#facc15" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorCons" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f87171" stopOpacity={0.5} />
                                        <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                <XAxis dataKey="uniqueTime" stroke="#ffffff80" tickFormatter={axisTimeFormat} tick={{ fontSize: 12 }} minTickGap={axisTickGap} tickMargin={10} />
                                <YAxis width={narrow ? 'auto' : 80} domain={[0, 'auto']} stroke="#ffffff80" tickFormatter={val => `${val}mW`} tickMargin={narrow ? 4 : 10} />
                                <Tooltip
                                    formatter={(value) => formatValue(value)}
                                    labelFormatter={tooltipTimeFormat}
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: CROSSHAIR_STROKE, strokeWidth: CROSSHAIR_WIDTH, strokeDasharray: `${CROSSHAIR_DASH} ${CROSSHAIR_DASH}` }}
                                />
                                <Area type="monotone" dataKey="solarPower" name={t('series.solar')} stroke="#facc15" fillOpacity={1} fill="url(#colorSolar)" />
                                <Area type="step" dataKey="systemConsumption" name={t('series.consumption')} stroke="#f87171" fillOpacity={1} fill="url(#colorCons)" />
                                {midnightPoints.map(uniqueTime => (
                                    <ReferenceLine key={`mid-${uniqueTime}`} x={uniqueTime} stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </ChartCrosshair>
                </div>

                {/*
                  Correlation chart: daylight vs temperature, which is what makes
                  the thermal lag visible — the ground keeps warming for an hour
                  or two after the light has peaked.

                  The light axis reads the photoresistor, not the panel. The panel
                  measures the current the charger is drawing, so once the battery
                  fills it collapses to near zero in full sun: measured on a clear
                  31/07, solar_mW fell from 2393 to 79 mW between 14:20 and 15:20
                  while the light barely moved. It also lags about three hours at
                  dawn, because the panel needs real irradiance before it produces
                  anything while the LDR sees first light straight away. Pairing
                  either artefact with temperature would invent a thermal lag that
                  is really just the charge controller.
                */}
                <div className="chart-card wide">
                    <h3>{t('chart.thermalLag')}</h3>
                    <ChartCrosshair>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={history} margin={{ top: 20, bottom: 20, ...wideChartMargin }}>
                                <CartesianGrid yAxisId="left" strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                <XAxis dataKey="uniqueTime" stroke="#ffffff80" tickFormatter={axisTimeFormat} tick={{ fontSize: 12 }} minTickGap={axisTickGap} tickMargin={10} />
                                <YAxis yAxisId="left" width={narrow ? 'auto' : 80} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke="#facc15" tickFormatter={val => `${val}%`} tickMargin={narrow ? 4 : 10} />
                                <YAxis yAxisId="right" orientation="right" width={narrow ? 'auto' : 60} domain={[0, 40]} ticks={[0, 10, 20, 30, 40]} stroke="#ff6b6b" tickFormatter={val => `${val}°C`} tickMargin={narrow ? 4 : 10} />
                                <Tooltip
                                    formatter={(value, name, entry) => [
                                        entry?.dataKey === 'luminosity'
                                            ? `${formatValue(value)} %`
                                            : `${formatReading(value)} °C`,
                                        name,
                                    ]}
                                    labelFormatter={tooltipTimeFormat}
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: CROSSHAIR_STROKE, strokeWidth: CROSSHAIR_WIDTH, strokeDasharray: `${CROSSHAIR_DASH} ${CROSSHAIR_DASH}` }}
                                />
                                {/*
                                  connectNulls stays off: a missing reading has to
                                  show as a gap. The backend omits luminosity when
                                  the sensor did not report, and bridging that would
                                  draw a straight line through hours that were never
                                  measured — which is exactly the artefact the night
                                  gap used to produce in Grafana.
                                */}
                                <Area yAxisId="left" type="monotone" dataKey="luminosity" name={t('series.daylight')} fill="#facc15" stroke="#facc15" fillOpacity={0.2} connectNulls={false} />
                                <Line yAxisId="right" type="monotone" dataKey="temperature" name={t('series.ambientTemp')} stroke="#ff6b6b" strokeWidth={3} dot={false} />
                                {midnightPoints.map(uniqueTime => (
                                    <ReferenceLine yAxisId="left" key={`mid-${uniqueTime}`} x={uniqueTime} stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" />
                                ))}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </ChartCrosshair>
                </div>

            </div>

            {/*
              One modal for whichever card was opened. It sits outside the two
              sections because it belongs to neither — and because <dialog>
              renders in the top layer regardless of where it is mounted, so its
              position here is about which component owns the state, not about
              where it appears.
            */}
            <MetricModal
                open={openMetric === 'temperature'}
                onClose={() => setOpenMetric(null)}
                title={t('card.temperature')}
                icon={Thermometer}
                color="#ff6b6b"
                toolbar={<>{temperatureTrend}{rangeSelector}</>}
            >
                <TemperatureDetail
                    history={history}
                    currentData={currentData}
                    stats={stats}
                    hours={timeRange}
                    axisTimeFormat={axisTimeFormat}
                    tooltipTimeFormat={tooltipTimeFormat}
                    axisTickGap={axisTickGap}
                />
            </MetricModal>

            <MetricModal
                open={openMetric === 'humidity'}
                onClose={() => setOpenMetric(null)}
                title={t('card.humidity')}
                icon={Droplets}
                color="#4dabf7"
                toolbar={rangeSelector}
            >
                <HumidityDetail
                    history={history}
                    stats={stats}
                    hours={timeRange}
                    axisTimeFormat={axisTimeFormat}
                    tooltipTimeFormat={tooltipTimeFormat}
                    axisTickGap={axisTickGap}
                />
            </MetricModal>
        </div>
    );
};

export default Dashboard;
