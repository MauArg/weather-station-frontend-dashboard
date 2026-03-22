import { startOfMonth, endOfMonth, eachDayOfInterval, format, startOfYear, endOfYear, eachMonthOfInterval, getDaysInMonth, setDate } from 'date-fns';

// Helper to generate random number in range with decimal
const random = (min, max) => {
    const val = Math.random() * (max - min) + min;
    return Number(val.toFixed(1));
};

// Helper for solar bell curve based on time of day
const getSolarPower = (date) => {
    const hours = date.getHours() + date.getMinutes() / 60;
    // Bell curve approximation: positive between 6 (sunrise) and 20 (sunset), peak at 13:00
    if (hours < 6 || hours > 20) return 0;
    const normalized = (hours - 6) / 14 * Math.PI; // Maps 6-20 to 0-PI
    // Perfect bell curve roughly using sine wave, with some noise
    const baseCurve = Math.sin(normalized) * 5200; // Peak 5200 mW
    const noise = random(-200, 200); 
    return Math.max(0, Number((baseCurve + noise).toFixed(0)));
};

export const getRealTimeData = () => {
    const now = new Date();
    const solarPower = getSolarPower(now);
    const systemConsumption = random(800, 1200); // base load 800-1200 mW
    const energyBalance = solarPower - systemConsumption;
    
    return {
        temperature: random(15, 35),
        humidity: random(30, 80),
        pressure: random(980, 1020),
        dewPoint: random(10, 20),
        solarPower: solarPower,
        systemConsumption: systemConsumption,
        energyBalance: energyBalance,
        batterySoc: random(85, 95), // mock high battery
        timestamp: now.toISOString(),
    };
};

export const getDailyStats = () => {
    return {
        maxTemp: { value: 32, time: '14:30:00' },
        minTemp: { value: 18, time: '04:15:00' },
        maxHumidity: { value: 85, time: '06:00:00' },
        minHumidity: { value: 40, time: '15:45:00' },
        maxPressure: { value: 1015, time: '10:00:00' },
        minPressure: { value: 998, time: '18:20:00' },
    }
}

export const getRecentHistory = (hours = 24) => {
    const data = [];
    const end = new Date();
    end.setSeconds(0, 0);

    const intervalMinutes = hours > 24 ? 60 : 30;
    const points = (hours * 60) / intervalMinutes;

    for (let i = points; i >= 0; i--) {
        const timestamp = new Date(end.getTime() - i * intervalMinutes * 60000);
        const solarPower = getSolarPower(timestamp);
        // Slightly correlative temperature with solar lag (peak at 15:00)
        // Let's make temp curve: min at 5:00, max at 15:00
        const timeOffset = timestamp.getHours() + timestamp.getMinutes() / 60;
        let tempBase = 20;
        if (timeOffset > 5 && timeOffset <= 15) {
            tempBase = 15 + ((timeOffset - 5) / 10) * 15; // 15 to 30
        } else if (timeOffset > 15) {
            tempBase = 30 - ((timeOffset - 15) / 14) * 10; // 30 drop to 20
        } else {
            tempBase = 20 - ((timeOffset) / 5) * 5; // drop to 15
        }
        
        const temp = tempBase + random(-1, 1);
        
        data.push({
            time: format(timestamp, 'HH:mm'),
            fullResDate: timestamp,
            temperature: Number(temp.toFixed(1)),
            humidity: random(40, 70),
            pressure: random(990, 1010),
            solarPower: solarPower,
            systemConsumption: random(800, 1200),
            energyBalance: solarPower - random(800, 1200)
        });
    }
    return data;
};

export const getHistoricData = (date) => {
    // Gen 24 hr
    const data = [];
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    for (let i = 0; i < 24; i++) {
        const timestamp = new Date(start);
        timestamp.setHours(i);
        const solarPower = getSolarPower(timestamp);
        
        data.push({
            time: format(timestamp, 'HH:mm'),
            temperature: random(15, 30) + (i > 10 && i < 18 ? 5 : 0),
            humidity: random(40, 70),
            pressure: random(990, 1010),
            solarPower: solarPower,
            systemConsumption: 1000,
            energyBalance: solarPower - 1000
        });
    }
    return data;
};

export const getYearlyTableData = (yearDate) => {
    const start = startOfYear(yearDate);
    const end = endOfYear(yearDate);
    const months = eachMonthOfInterval({ start, end });

    return months.map(month => {
        const daysInMonth = getDaysInMonth(month);
        const dayData = {};
        for (let d = 1; d <= daysInMonth; d++) {
            const date = setDate(month, d);
            const baseTemp = random(10, 30);
            dayData[d] = {
                date: date,
                maxTemp: baseTemp + random(2, 8),
                minTemp: baseTemp - random(2, 5)
            };
        }
        return {
            monthName: format(month, 'MMM'),
            days: dayData
        };
    });
}
