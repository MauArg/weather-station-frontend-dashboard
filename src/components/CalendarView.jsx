import React, { useState, useEffect } from 'react';
import { format, addYears, subYears } from 'date-fns';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getYearlyTableData, getHistoricData } from '../services/MockDataService';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const CalendarView = ({ onBack }) => {
    const formatTemp = (val) => {
        if (typeof val !== 'number') return val;
        return val.toFixed(1).replace('.', ',');
    };

    const [currentDate, setCurrentDate] = useState(new Date());
    const [yearData, setYearData] = useState([]); // Array of 12 month objects
    const [selectedDay, setSelectedDay] = useState(null);
    const [historyData, setHistoryData] = useState(null);

    useEffect(() => {
        const data = getYearlyTableData(currentDate);
        setYearData(data);
    }, [currentDate]);

    useEffect(() => {
        if (selectedDay) {
            setHistoryData(getHistoricData(selectedDay));
        }
    }, [selectedDay]);

    const getStyle = (temp) => {
        let bg, color = 'black';

        // <0: Dark Blue
        if (temp < 0) { bg = '#313695'; color = 'white'; }
        // 0-5: Medium Blue
        else if (temp < 5) { bg = '#4575b4'; color = 'white'; }
        // 5-10: Light Blue
        else if (temp < 10) { bg = '#74add1'; color = 'black'; }
        // 10-15: Cyan/Teal
        else if (temp < 15) { bg = '#abd9e9'; color = 'black'; }
        // 15-20: Light Green
        else if (temp < 20) { bg = '#e0f3f8'; color = 'black'; }
        // 20-25: Yellow
        else if (temp < 25) { bg = '#ffffbf'; color = 'black'; }
        // 25-30: Orange-Yellow
        else if (temp < 30) { bg = '#fee090'; color = 'black'; }
        // 30-35: Orange
        else if (temp < 35) { bg = '#fdae61'; color = 'black'; }
        // 35-40: Red-Orange
        else if (temp < 40) { bg = '#f46d43'; color = 'white'; }
        // >40: Dark Red
        else { bg = '#d73027'; color = 'white'; }

        return { backgroundColor: bg, color: color };
    }

    const handleCellClick = (dayInfo) => {
        setSelectedDay(dayInfo.date);
    };

    const nextYear = () => setCurrentDate(addYears(currentDate, 1));
    const prevYear = () => setCurrentDate(subYears(currentDate, 1));

    if (selectedDay && historyData) {
        return (
            <div className="history-view">
                <div className="history-header">
                    <button onClick={() => setSelectedDay(null)} className="back-btn"><ChevronLeft /> Back to Calendar</button>
                    <h2>History for {format(selectedDay, 'MMMM d, yyyy')}</h2>
                </div>
                <div className="charts-grid">
                    <div className="chart-card wide">
                        <h3>Temperature History</h3>
                        <div className="chart-wrapper">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={historyData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                    <XAxis dataKey="time" stroke="#ffffff80" />
                                    <YAxis stroke="#ffffff80" />
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none' }} />
                                    <Area type="monotone" dataKey="temperature" stroke="#ff6b6b" fill="#ff6b6b80" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="calendar-container full-width">
            <div className="calendar-header">
                <button onClick={onBack} className="close-btn"><X /> Close</button>
                <div className="year-nav">
                    <button onClick={prevYear}><ChevronLeft /></button>
                    <h2>{format(currentDate, 'yyyy')}</h2>
                    <button onClick={nextYear}><ChevronRight /></button>
                </div>
            </div>

            <div className="table-wrapper">
                <table className="calendar-table">
                    <thead>
                        <tr>
                            <th rowSpan="2" className="sticky-col">Day</th>
                            {yearData.map((m, i) => (
                                <th key={i} colSpan="2" className="month-header">{m.monthName}</th>
                            ))}
                        </tr>
                        <tr>
                            {yearData.map((_, i) => (
                                <React.Fragment key={i}>
                                    <th className="sub-header">Max</th>
                                    <th className="sub-header">Min</th>
                                </React.Fragment>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(dayNum => (
                            <tr key={dayNum}>
                                <td className="sticky-col day-cell">{dayNum}</td>
                                {yearData.map((month, mIdx) => {
                                    const dayData = month.days[dayNum];
                                    if (!dayData) {
                                        // Invalid date for this month (e.g. Feb 30)
                                        return (
                                            <React.Fragment key={mIdx}>
                                                <td className="empty-cell"></td>
                                                <td className="empty-cell"></td>
                                            </React.Fragment>
                                        );
                                    }
                                    return (
                                        <React.Fragment key={mIdx}>
                                            <td
                                                className="data-cell"
                                                style={getStyle(dayData.maxTemp)}
                                                onClick={() => handleCellClick(dayData)}
                                                title={`Max: ${dayData.maxTemp}°C`}
                                            >
                                                {formatTemp(dayData.maxTemp)}
                                            </td>
                                            <td
                                                className="data-cell"
                                                style={getStyle(dayData.minTemp)}
                                                onClick={() => handleCellClick(dayData)}
                                                title={`Min: ${dayData.minTemp}°C`}
                                            >
                                                {formatTemp(dayData.minTemp)}
                                            </td>
                                        </React.Fragment>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="legend">
                <div className="legend-item" style={{ background: '#313695', color: 'white' }}> &lt; 0° </div>
                <div className="legend-item" style={{ background: '#4575b4', color: 'white' }}> 0-5° </div>
                <div className="legend-item" style={{ background: '#74add1', color: 'black' }}> 5-10° </div>
                <div className="legend-item" style={{ background: '#abd9e9', color: 'black' }}> 10-15° </div>
                <div className="legend-item" style={{ background: '#e0f3f8', color: 'black' }}> 15-20° </div>
                <div className="legend-item" style={{ background: '#ffffbf', color: 'black' }}> 20-25° </div>
                <div className="legend-item" style={{ background: '#fee090', color: 'black' }}> 25-30° </div>
                <div className="legend-item" style={{ background: '#fdae61', color: 'black' }}> 30-35° </div>
                <div className="legend-item" style={{ background: '#f46d43', color: 'white' }}> 35-40° </div>
                <div className="legend-item" style={{ background: '#d73027', color: 'white' }}> &gt; 40° </div>
            </div>
        </div>
    );
};

export default CalendarView;
