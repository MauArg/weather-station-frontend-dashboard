import React, { useState, useEffect } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart } from 'recharts';
import { Thermometer, Droplets, Gauge, CloudRain, Clock, Battery, Sun, Zap, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import StatCard from './StatCard';
import { getRealTimeData, getDailyStats, getRecentHistory } from '../services/MockDataService';

const Dashboard = () => {
    const formatValue = (val) => {
        if (typeof val !== 'number') return val;
        return val.toFixed(1).replace('.', ',');
    };

    const [currentData, setCurrentData] = useState(null);
    const [history, setHistory] = useState([]);
    const [stats, setStats] = useState(null);
    const [timeRange, setTimeRange] = useState(24); // 6, 24, 48, 72 hours
    const [activeTemp, setActiveTemp] = useState(null);
    const [activeHum, setActiveHum] = useState(null);

    const [activeEnergy, setActiveEnergy] = useState(null);

    useEffect(() => {
        // Initial fetch
        const data = getRealTimeData();
        setCurrentData(data);
        setStats(getDailyStats());

        // Load history based on selected range
        setHistory(getRecentHistory(timeRange));

        const interval = setInterval(() => {
            const newData = getRealTimeData();
            setCurrentData(newData);

            setHistory(prev => {
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

                const lastPoint = prev[prev.length - 1];

                if (lastPoint && lastPoint.time === timeStr) {
                    const newHistory = [...prev];
                    newHistory[newHistory.length - 1] = { ...newData, time: timeStr };
                    return newHistory;
                }

                const newHistory = [...prev, {
                    ...newData,
                    time: timeStr
                }];
                return newHistory.slice(-100);
            });
        }, 3000);

        return () => clearInterval(interval);
    }, [timeRange]); // Re-run when timeRange changes

    if (!currentData || !stats) return <div className="loading">Loading Weather Station...</div>;

    const isCharging = currentData.energyBalance > 0;

    return (
        <div className="dashboard-container">
            {/* Top Stats Row */}
            <div className="stats-grid">
                <StatCard
                    title="Temperature"
                    value={formatValue(currentData.temperature)}
                    unit="°C"
                    icon={Thermometer}
                    color="#ff6b6b"
                />
                <StatCard
                    title="Humidity"
                    value={formatValue(currentData.humidity)}
                    unit="%"
                    icon={Droplets}
                    color="#4dabf7"
                />
                <StatCard
                    title="Pressure"
                    value={formatValue(currentData.pressure)}
                    unit="hPa"
                    icon={Gauge}
                    color="#ffd43b"
                />
                <StatCard
                    title="Dew Point"
                    value={formatValue(currentData.dewPoint)}
                    unit="°C"
                    icon={CloudRain}
                    color="#69db7c"
                />
            </div>

            {/* Energy Centerpiece */}
            <div className={`energy-centerpiece ${isCharging ? 'pulse-animation-positive' : 'pulse-animation-negative'}`}>
                <div className="energy-subtitle">Instant Energy Balance</div>
                <div className={`energy-balance-value ${isCharging ? 'energy-balance-positive' : 'energy-balance-negative'}`}>
                    {isCharging ? <ArrowUpCircle size={64} /> : <ArrowDownCircle size={64} />}
                    {Math.abs(currentData.energyBalance).toFixed(0)} <span style={{ fontSize: '2rem', marginTop: '1rem' }}>mW</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '3rem', marginTop: '1rem' }}>
                    <div style={{ color: '#fde047', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                        <Sun size={20} /> Production: {formatValue(currentData.solarPower)} mW
                    </div>
                    <div style={{ color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                        <Zap size={20} /> Consumption: {formatValue(currentData.systemConsumption)} mW
                    </div>
                    <div style={{ color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                        <Battery size={20} /> Battery SOC: {formatValue(currentData.batterySoc)}%
                    </div>
                </div>
            </div>

            {/* Main Graphs */}
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>Live Data</h3>
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
                    <h3>Real-time Temperature</h3>
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
                                <XAxis dataKey="time" stroke="#ffffff80" tick={{ fontSize: 12 }} minTickGap={30} />
                                <YAxis domain={['auto', 'auto']} stroke="#ffffff80" tickFormatter={val => `${val}°`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area type="monotone" dataKey="temperature" stroke="#ff6b6b" fillOpacity={1} fill="url(#colorTemp)" />
                                {activeTemp !== null && (
                                    <ReferenceLine y={activeTemp} stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" />
                                )}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="chart-card">
                    <h3>Real-time Humidity</h3>
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
                                <XAxis dataKey="time" stroke="#ffffff80" tick={{ fontSize: 12 }} minTickGap={30} />
                                <YAxis domain={[0, 100]} stroke="#ffffff80" tickFormatter={val => `${val}%`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area type="monotone" dataKey="humidity" stroke="#4dabf7" fillOpacity={1} fill="url(#colorHum)" />
                                {activeHum !== null && (
                                    <ReferenceLine y={activeHum} stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" />
                                )}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Energy Chart: Production curve and consumption */}
                <div className="chart-card wide">
                    <h3>Solar Engine & Consumption</h3>
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
                                <XAxis dataKey="time" stroke="#ffffff80" tick={{ fontSize: 12 }} minTickGap={30} tickMargin={10} />
                                <YAxis width={80} domain={[0, 'auto']} stroke="#ffffff80" tickFormatter={val => `${val}mW`} tickMargin={10} padding={{ top: 20, bottom: 20 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area type="monotone" dataKey="solarPower" name="Solar Prod." stroke="#facc15" fillOpacity={1} fill="url(#colorSolar)" />
                                <Area type="step" dataKey="systemConsumption" name="Consumption" stroke="#f87171" fillOpacity={1} fill="url(#colorCons)" />
                                {activeEnergy !== null && (
                                    <ReferenceLine y={activeEnergy} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
                                )}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Correlation Chart: Irradiance (Solar) vs Temperature (Shows thermal lag) */}
                <div className="chart-card wide">
                    <h3>Weather: Solar vs Thermal Lag</h3>
                    <div className="chart-wrapper" style={{ cursor: 'crosshair' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={history} margin={{ top: 20, right: 30, left: 30, bottom: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                <XAxis dataKey="time" stroke="#ffffff80" tick={{ fontSize: 12 }} minTickGap={30} tickMargin={10} />
                                <YAxis yAxisId="left" width={80} domain={[0, 6000]} stroke="#facc15" tickFormatter={val => `${val}mW`} tickMargin={10} padding={{ top: 20, bottom: 20 }} />
                                <YAxis yAxisId="right" orientation="right" width={60} domain={[0, 40]} stroke="#ff6b6b" tickFormatter={val => `${val}°C`} tickMargin={10} padding={{ top: 20, bottom: 20 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area yAxisId="left" type="monotone" dataKey="solarPower" name="Solar Heat Input" fill="#facc15" stroke="#facc15" fillOpacity={0.2} />
                                <Line yAxisId="right" type="monotone" dataKey="temperature" name="Ambient Temp" stroke="#ff6b6b" strokeWidth={3} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

            </div>

            {/* Daily Extremes */}
            <div className="extremes-grid">
                <div className="extreme-card">
                    <h4>Max Temp</h4>
                    <span>{formatValue(stats.maxTemp.value)}°C</span>
                    <small>at {stats.maxTemp.time}</small>
                </div>
                <div className="extreme-card">
                    <h4>Min Temp</h4>
                    <span>{formatValue(stats.minTemp.value)}°C</span>
                    <small>at {stats.minTemp.time}</small>
                </div>
                {/* Add more extremes as needed */}
            </div>
        </div>
    );
};

export default Dashboard;
