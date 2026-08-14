import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { format, addYears, subYears } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, Loader2 } from 'lucide-react';
import { getYearlyTableData, getHistoricData } from '../services/ApiService';
import { formatNumber } from '../utils/timezone';
import toast from 'react-hot-toast';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCrosshair, { CROSSHAIR_STROKE, CROSSHAIR_WIDTH, CROSSHAIR_DASH } from './ChartCrosshair';

// The only place date-fns renders words rather than digits. Its locale follows
// the UI language —month names are words— while everything numeric in this view
// still goes through the fixed es-AR formatters.
const DATE_FNS_LOCALES = { en: enUS, es };

const CalendarView = ({ onBack }) => {
    const { t, i18n } = useTranslation('calendar');
    const dateLocale = DATE_FNS_LOCALES[i18n.resolvedLanguage] ?? enUS;
    const monthNames = t('months', { returnObjects: true });

    // One decimal, with this locale's comma. It used to be toFixed(1) followed by
    // a hand-rolled '.' → ',' swap, which produced the same string only because
    // no temperature reaches four digits.
    const formatTemp = (val) => formatNumber(val, { digits: 1, minDigits: 1 });

    const [currentDate, setCurrentDate] = useState(new Date());
    const [yearData, setYearData] = useState([]); // Array of 12 month objects
    const [selectedDay, setSelectedDay] = useState(null);
    const [historyData, setHistoryData] = useState(null);

    const [isLoadingYear, setIsLoadingYear] = useState(true);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    useEffect(() => {
        let isMounted = true;
        const loadYearData = async () => {
            setIsLoadingYear(true);
            try {
                const data = await getYearlyTableData(currentDate);
                if (isMounted) setYearData(data);
            } catch (error) {
                console.error(error);
                if (isMounted) toast.error(t('toast.loadCalendarFailed'));
            } finally {
                if (isMounted) setIsLoadingYear(false);
            }
        };
        loadYearData();
        return () => { isMounted = false; };
        // `t` stays out of the deps for the same reason as in Dashboard: it is
        // only read in the error branch, and including it would refetch the whole
        // year on a language change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentDate]);

    useEffect(() => {
        if (!selectedDay) return;
        let isMounted = true;
        const loadHistory = async () => {
            setIsLoadingHistory(true);
            try {
                const data = await getHistoricData(selectedDay);
                if (isMounted) setHistoryData(data);
            } catch (error) {
                console.error(error);
                if (isMounted) toast.error(t('toast.loadHistoryFailed'));
            } finally {
                if (isMounted) setIsLoadingHistory(false);
            }
        };
        loadHistory();
        return () => { isMounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    if (selectedDay) {
        return (
            <div className="history-view">
                <div className="history-header">
                    <button onClick={() => setSelectedDay(null)} className="back-btn"><ChevronLeft /> {t('backToCalendar')}</button>
                    <h2>{t('historyFor', { date: format(selectedDay, t('longDateFormat'), { locale: dateLocale }) })}</h2>
                </div>
                {isLoadingHistory || !historyData ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem' }}>
                        <Loader2 className="animate-spin" size={48} color="#4dabf7" />
                        <p>{t('loadingHistory')}</p>
                    </div>
                ) : (
                <div className="charts-grid">
                    <div className="chart-card wide">
                        <h3>{t('chart.temperatureHistory')}</h3>
                        <ChartCrosshair>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={historyData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff20" />
                                    <XAxis dataKey="time" stroke="#ffffff80" />
                                    <YAxis stroke="#ffffff80" />
                                    <Tooltip
                                        formatter={(value) => formatNumber(value)}
                                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none' }}
                                        cursor={{ stroke: CROSSHAIR_STROKE, strokeWidth: CROSSHAIR_WIDTH, strokeDasharray: `${CROSSHAIR_DASH} ${CROSSHAIR_DASH}` }}
                                    />
                                    <Area type="monotone" dataKey="temperature" name={t('series.temperature')} stroke="#ff6b6b" fill="#ff6b6b80" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </ChartCrosshair>
                    </div>
                </div>
                )}
            </div>
        )
    }

    if (isLoadingYear) {
        return (
            <div className="calendar-container full-width" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', gap: '1rem' }}>
                <Loader2 className="animate-spin" size={48} color="#4dabf7" />
                <p>{t('loading')}</p>
            </div>
        );
    }

    return (
        <div className="calendar-container full-width">
            <div className="calendar-header">
                <button onClick={onBack} className="close-btn"><X /> {t('close')}</button>
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
                            <th rowSpan="2" className="sticky-col">{t('column.day')}</th>
                            {/* The month name comes from the column's position, not
                                from the payload's `monthName`. The backend builds
                                that array as twelve fixed English abbreviations in
                                calendar order, so the index already carries the
                                whole meaning — and a label the API hardcodes is one
                                the language switch could never reach. */}
                            {yearData.map((_, i) => (
                                <th key={i} colSpan="2" className="month-header">{monthNames[i]}</th>
                            ))}
                        </tr>
                        <tr>
                            {yearData.map((_, i) => (
                                <React.Fragment key={i}>
                                    <th className="sub-header">{t('column.max')}</th>
                                    <th className="sub-header">{t('column.min')}</th>
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
                                                title={t('cell.max', { temp: formatTemp(dayData.maxTemp) })}
                                            >
                                                {formatTemp(dayData.maxTemp)}
                                            </td>
                                            <td
                                                className="data-cell"
                                                style={getStyle(dayData.minTemp)}
                                                onClick={() => handleCellClick(dayData)}
                                                title={t('cell.min', { temp: formatTemp(dayData.minTemp) })}
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
