import { startOfMonth, endOfMonth, eachDayOfInterval, format, startOfYear, endOfYear, eachMonthOfInterval, getDaysInMonth, setDate } from 'date-fns';

// Helper to generate random number in range
// Helper to generate random number in range with decimal
const random = (min, max) => {
    const val = Math.random() * (max - min) + min;
    return Number(val.toFixed(1));
};

export const getRealTimeData = () => {
    return {
        temperature: random(15, 35),
        humidity: random(30, 80),
        pressure: random(980, 1020),
        dewPoint: random(10, 20),
        timestamp: new Date().toISOString(),
    };
};

export const getDailyStats = () => {
    // Return max/min for today
    return {
        maxTemp: { value: 32, time: '14:30:00' },
        minTemp: { value: 18, time: '04:15:00' },
        maxHumidity: { value: 85, time: '06:00:00' },
        minHumidity: { value: 40, time: '15:45:00' },
        maxPressure: { value: 1015, time: '10:00:00' },
        minPressure: { value: 998, time: '18:20:00' },
    }
}

// Generate history for the last N hours
export const getRecentHistory = (hours = 24) => {
    const data = [];
    const end = new Date();
    // Round down to nearest minute for cleaner display
    end.setSeconds(0, 0);

    // Generate points every hour for longer ranges, or every 15 mins for shorter ranges
    const intervalMinutes = hours > 24 ? 60 : 30;
    const points = (hours * 60) / intervalMinutes;

    for (let i = points; i >= 0; i--) {
        const timestamp = new Date(end.getTime() - i * intervalMinutes * 60000);
        data.push({
            time: format(timestamp, 'HH:mm'), // Display time
            fullResDate: timestamp, // For sorting/key if needed
            temperature: random(15, 30),
            humidity: random(40, 70),
            pressure: random(990, 1010),
        });
    }
    return data;
};

export const getHistoricData = (date) => {
    // Generate 24 hours of data for the given date
    const data = [];
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    for (let i = 0; i < 24; i++) {
        const timestamp = new Date(start);
        timestamp.setHours(i);
        data.push({
            time: format(timestamp, 'HH:mm'),
            temperature: random(15, 30) + (i > 10 && i < 18 ? 5 : 0), // warmer at midday
            humidity: random(40, 70),
            pressure: random(990, 1010),
        });
    }
    return data;
};

// Returns an array of 12 months, each containing an array of days (1-31)
// If a month has less than 31 days, the extra slots will be null or marked distinctively
export const getYearlyTableData = (yearDate) => {
    const start = startOfYear(yearDate);
    const end = endOfYear(yearDate);
    const months = eachMonthOfInterval({ start, end });

    // We want a structure that is easy to map to rows (days 1-31)
    // Let's create an array of 12 months, where each month is a map of day -> data

    return months.map(month => {
        const daysInMonth = getDaysInMonth(month);
        const dayData = {};

        for (let d = 1; d <= daysInMonth; d++) {
            // Create a date object for specific day
            const date = setDate(month, d);
            const baseTemp = random(10, 30);
            dayData[d] = {
                date: date,
                maxTemp: baseTemp + random(2, 8),
                minTemp: baseTemp - random(2, 5)
            };
        }

        return {
            monthName: format(month, 'MMM'), // Jan, Feb, etc.
            days: dayData
        };
    });
}
