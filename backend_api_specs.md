# Weather Station Dashboard - Backend API Specifications

Este documento describe los contratos de la API (endpoints, parámetros y formatos de respuesta) que el frontend espera del backend. Fue generado a partir del `MockDataService` actual para facilitar la implementación del backend real y asegurar una integración sin problemas.

## Base URL Sugerida
Se asume que la API estará servida bajo un prefijo común, por ejemplo: `/api/v1`

---

## 1. Datos en Tiempo Real
Obtiene los datos más recientes capturados por la estación. Reemplaza a `getRealTimeData()`.

**Endpoint:** `GET /weather/current`

**Respuesta Esperada (200 OK):**
```json
{
  "temperature": 25.5,
  "humidity": 60,
  "pressure": 1005,
  "dewPoint": 15.2,
  "solarPower": 3200,
  "systemConsumption": 950,
  "energyBalance": 2250,
  "batterySoc": 92,
  "timestamp": "2026-05-17T12:00:00.000Z"
}
```
*Notas: Las potencias están expresadas en mW. El `timestamp` debe estar en formato ISO 8601.*

---

## 2. Estadísticas Diarias
Obtiene los valores máximos y mínimos registrados en el día actual. Reemplaza a `getDailyStats()`.

**Endpoint:** `GET /weather/stats/daily`

**Respuesta Esperada (200 OK):**
```json
{
  "maxTemp": { "value": 32.5, "time": "14:30:00" },
  "minTemp": { "value": 18.2, "time": "04:15:00" },
  "maxHumidity": { "value": 85.0, "time": "06:00:00" },
  "minHumidity": { "value": 40.0, "time": "15:45:00" },
  "maxPressure": { "value": 1015.0, "time": "10:00:00" },
  "minPressure": { "value": 998.0, "time": "18:20:00" }
}
```

---

## 3. Historial Reciente (Gráficos principales)
Obtiene la serie temporal de datos de las últimas X horas. Reemplaza a `getRecentHistory(hours)`.

**Endpoint:** `GET /weather/history/recent`

**Query Parameters:**
- `hours` (number): Cantidad de horas hacia atrás a consultar (ej: `6`, `24`, `48`, `72`).

**Respuesta Esperada (200 OK):**
*Array de objetos ordenados cronológicamente. Típicamente con puntos cada 30 o 60 minutos según el rango.*
```json
[
  {
    "time": "12:00",
    "fullResDate": "2026-05-17T12:00:00.000Z",
    "temperature": 26.1,
    "humidity": 58,
    "pressure": 1002,
    "solarPower": 3100,
    "systemConsumption": 980,
    "energyBalance": 2120
  },
  {
    "time": "12:30",
    "fullResDate": "2026-05-17T12:30:00.000Z",
    "temperature": 26.5,
    "humidity": 55,
    "pressure": 1002,
    "solarPower": 3200,
    "systemConsumption": 950,
    "energyBalance": 2250
  }
]
```

---

## 4. Datos Históricos de un Día Específico
Obtiene la serie temporal (24 horas) para una fecha determinada. Reemplaza a `getHistoricData(date)`.

**Endpoint:** `GET /weather/history/day`

**Query Parameters:**
- `date` (string): Fecha objetivo en formato `YYYY-MM-DD` o ISO.

**Respuesta Esperada (200 OK):**
*Array de objetos, idealmente un punto por hora.*
```json
[
  {
    "time": "00:00",
    "temperature": 18.5,
    "humidity": 70,
    "pressure": 1010,
    "solarPower": 0,
    "systemConsumption": 1000,
    "energyBalance": -1000
  },
  // ... (24 elementos, hasta las 23:00)
]
```

---

## 5. Tabla de Datos Anuales (Heatmap/Calendario)
Obtiene los datos resumidos (máximas y mínimas de temperatura) por día para todos los meses de un año. Reemplaza a `getYearlyTableData(yearDate)`.

**Endpoint:** `GET /weather/history/year`

**Query Parameters:**
- `year` (string/number): Año solicitado (ej: `2026`).

**Respuesta Esperada (200 OK):**
*Array de 12 objetos, uno por cada mes del año.*
```json
[
  {
    "monthName": "Jan",
    "days": {
      "1": {
        "date": "2026-01-01T00:00:00.000Z",
        "maxTemp": 35.2,
        "minTemp": 20.1
      },
      "2": {
        "date": "2026-01-02T00:00:00.000Z",
        "maxTemp": 34.8,
        "minTemp": 21.0
      }
      // ... hasta el último día del mes
    }
  },
  {
    "monthName": "Feb",
    "days": { /* ... */ }
  }
  // ... hasta Dec
]
```
