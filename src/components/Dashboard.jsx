import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart } from 'recharts';
import { Thermometer, Droplets, Gauge, CloudRain, Battery, BatteryCharging, CheckCircle2, Moon, AlertTriangle, HelpCircle, Sun, Zap, Loader2 } from 'lucide-react';
import StatCard from './StatCard';
import { getRealTimeData, getDailyStats, getRecentHistory } from '../services/ApiService';
import { formatTime, formatNumber } from '../utils/timezone';
import toast from 'react-hot-toast';

const Dashboard = () => {
    const { t } = useTranslation('dashboard');

    const formatValue = (val) => formatNumber(val);

    const [currentData, setCurrentData] = useState(null);
    const [history, setHistory] = useState([]);
    const [stats, setStats] = useState(null);
    const [timeRange, setTimeRange] = useState(24); // 6, 24, 48, 72 hours
    const [activeTemp, setActiveTemp] = useState(null);
    const [activeHum, setActiveHum] = useState(null);

    const [activeEnergy, setActiveEnergy] = useState(null);

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

    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const loadData = async () => {
            setIsLoading(true);
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
                if (isMounted) setIsLoading(false);
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
            clearInterval(historyInterval);
        };
        // `t` is intentionally out of the dependency list: it is only read inside
        // the error branch, and adding it would re-fetch every series on a
        // language change. The toast that follows a failed load is transient
        // anyway — it is gone long before anyone could switch languages.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeRange]); // Re-run when timeRange changes

    if (isLoading || !currentData || !stats) {
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
    const formatPressure = (val) => formatNumber(val, { grouping: false });

    const pressureVariants = currentData.pressureQnh == null ? null : [
        { key: 'qnh', value: formatPressure(currentData.pressureQnh), unit: 'hPa', caption: t('pressure.qnh') },
        { key: 'station', value: formatPressure(currentData.pressure), unit: 'hPa', caption: t('pressure.station') },
    ];

    const midnightPoints = [];
    if (history.length > 0) {
        for (let i = 1; i < history.length; i++) {
            if (!history[i-1].uniqueTime || !history[i].uniqueTime) continue;
            const prevDate = new Date(history[i-1].uniqueTime);
            const currDate = new Date(history[i].uniqueTime);
            if (prevDate.getDate() !== currDate.getDate()) {
                midnightPoints.push(history[i].uniqueTime);
            }
        }
    }

    return (
        <div className="dashboard-container">
            {/* Top Stats Row */}
            <div className="stats-grid">
                <StatCard
                    title={t('card.temperature')}
                    value={formatValue(currentData.temperature)}
                    unit="°C"
                    icon={Thermometer}
                    color="#ff6b6b"
                />
                <StatCard
                    title={t('card.humidity')}
                    value={formatValue(currentData.humidity)}
                    unit="%"
                    icon={Droplets}
                    color="#4dabf7"
                />
                <StatCard
                    title={t('card.pressure')}
                    value={formatValue(currentData.pressure)}
                    unit="hPa"
                    icon={Gauge}
                    color="#ffd43b"
                    variants={pressureVariants}
                    activeVariant={pressureMode}
                    onCycleVariant={setPressureMode}
                />
                <StatCard
                    title={t('card.dewPoint')}
                    value={formatValue(currentData.dewPoint)}
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
                        <Battery size={20} aria-hidden="true" /> {t('energy.battery')} {formatValue(currentData.batterySoc)}%
                        {currentData.batteryVolts != null && ` · ${formatValue(currentData.batteryVolts)} V`}
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
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>{t('section.liveData')}</h3>
                <div className="time-controls" style={{ display: 'flex', gap: '0.5rem' }}>
                    {[6, 24, 48, 72].map(hours => (
                        <button
                            key={hours}
                            onClick={() => setTimeRange(hours)}
                            style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '4px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: timeRange === hours ? 'rgba(255,255,255,0.2)' : 'transparent',
                                color: 'white',
                                cursor: 'pointer'
                            }}
                        >
                            {hours}h
                        </button>
                    ))}
                </div>
            </div>

            <div className="charts-grid">
                <div className="chart-card">
                    <h3>{t('chart.temperature')}</h3>
                    <div className="chart-wrapper" style={{ cursor: 'crosshair' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={history}
                                onMouseMove={(e) => {
                                    if (e.activePayload && e.activePayload[0]) {
                                        setActiveTemp(e.activePayload[0].payload.temperature);
                                    }
                                }}
                                onMouseLeave={() => setActiveTemp(null)}
                            >
                                <defs>
                                    <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ff6b6b" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#ff6b6b" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                <XAxis dataKey="uniqueTime" stroke="#ffffff80" tickFormatter={formatTime} tick={{ fontSize: 12 }} minTickGap={30} />
                                <YAxis domain={['auto', 'auto']} stroke="#ffffff80" tickFormatter={val => `${val}°`} />
                                <Tooltip
                                    formatter={(value) => formatValue(value)}
                                    labelFormatter={formatTime}
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                {/* `name` is not decoration: without it the tooltip
                                    falls back to the dataKey and prints the raw
                                    field name, which is neither language. */}
                                <Area type="monotone" dataKey="temperature" name={t('series.temperature')} stroke="#ff6b6b" fillOpacity={1} fill="url(#colorTemp)" />
                                {activeTemp !== null && (
                                    <ReferenceLine y={activeTemp} stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" />
                                )}
                                {midnightPoints.map(uniqueTime => (
                                    <ReferenceLine key={`mid-${uniqueTime}`} x={uniqueTime} stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="chart-card">
                    <h3>{t('chart.humidity')}</h3>
                    <div className="chart-wrapper" style={{ cursor: 'crosshair' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={history}
                                onMouseMove={(e) => {
                                    if (e.activePayload && e.activePayload[0]) {
                                        setActiveHum(e.activePayload[0].payload.humidity);
                                    }
                                }}
                                onMouseLeave={() => setActiveHum(null)}
                            >
                                <defs>
                                    <linearGradient id="colorHum" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#4dabf7" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#4dabf7" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                <XAxis dataKey="uniqueTime" stroke="#ffffff80" tickFormatter={formatTime} tick={{ fontSize: 12 }} minTickGap={30} />
                                <YAxis domain={[0, 100]} stroke="#ffffff80" tickFormatter={val => `${val}%`} />
                                <Tooltip
                                    formatter={(value) => formatValue(value)}
                                    labelFormatter={formatTime}
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area type="monotone" dataKey="humidity" name={t('series.humidity')} stroke="#4dabf7" fillOpacity={1} fill="url(#colorHum)" />
                                {activeHum !== null && (
                                    <ReferenceLine y={activeHum} stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" />
                                )}
                                {midnightPoints.map(uniqueTime => (
                                    <ReferenceLine key={`mid-${uniqueTime}`} x={uniqueTime} stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Energy Chart: Production curve and consumption */}
                <div className="chart-card wide">
                    <h3>{t('chart.energy')}</h3>
                    <div className="chart-wrapper" style={{ cursor: 'crosshair' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={history}
                                margin={{ top: 20, right: 30, left: 30, bottom: 5 }}
                                onMouseMove={(e) => {
                                    if (e.activePayload && e.activePayload[0]) {
                                        setActiveEnergy(e.activePayload[0].payload.solarPower);
                                    }
                                }}
                                onMouseLeave={() => setActiveEnergy(null)}
                            >
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
                                <XAxis dataKey="uniqueTime" stroke="#ffffff80" tickFormatter={formatTime} tick={{ fontSize: 12 }} minTickGap={30} tickMargin={10} />
                                <YAxis width={80} domain={[0, 'auto']} stroke="#ffffff80" tickFormatter={val => `${val}mW`} tickMargin={10} />
                                <Tooltip
                                    formatter={(value) => formatValue(value)}
                                    labelFormatter={formatTime}
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area type="monotone" dataKey="solarPower" name={t('series.solar')} stroke="#facc15" fillOpacity={1} fill="url(#colorSolar)" />
                                <Area type="step" dataKey="systemConsumption" name={t('series.consumption')} stroke="#f87171" fillOpacity={1} fill="url(#colorCons)" />
                                {activeEnergy !== null && (
                                    <ReferenceLine y={activeEnergy} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
                                )}
                                {midnightPoints.map(uniqueTime => (
                                    <ReferenceLine key={`mid-${uniqueTime}`} x={uniqueTime} stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
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
                    <div className="chart-wrapper" style={{ cursor: 'crosshair' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={history} margin={{ top: 20, right: 30, left: 30, bottom: 20 }}>
                                <CartesianGrid yAxisId="left" strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                <XAxis dataKey="uniqueTime" stroke="#ffffff80" tickFormatter={formatTime} tick={{ fontSize: 12 }} minTickGap={30} tickMargin={10} />
                                <YAxis yAxisId="left" width={80} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke="#facc15" tickFormatter={val => `${val}%`} tickMargin={10} />
                                <YAxis yAxisId="right" orientation="right" width={60} domain={[0, 40]} ticks={[0, 10, 20, 30, 40]} stroke="#ff6b6b" tickFormatter={val => `${val}°C`} tickMargin={10} />
                                <Tooltip
                                    formatter={(value, name, entry) => [
                                        `${formatValue(value)} ${entry?.dataKey === 'luminosity' ? '%' : '°C'}`,
                                        name,
                                    ]}
                                    labelFormatter={formatTime}
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
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
                    </div>
                </div>

            </div>

            {/* Daily Extremes */}
            <div className="extremes-grid">
                <div className="extreme-card">
                    <h4>{t('extremes.maxTemp')}</h4>
                    <span>{formatValue(stats.maxTemp.value)}°C</span>
                    <small>{t('extremes.at', { time: stats.maxTemp.time })}</small>
                </div>
                <div className="extreme-card">
                    <h4>{t('extremes.minTemp')}</h4>
                    <span>{formatValue(stats.minTemp.value)}°C</span>
                    <small>{t('extremes.at', { time: stats.minTemp.time })}</small>
                </div>
                {/* Add more extremes as needed */}
            </div>
        </div>
    );
};

export default Dashboard;
