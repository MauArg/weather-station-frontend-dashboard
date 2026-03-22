# Estación Meteorológica Solar — Catálogo de Datos
> **Ubicación:** Embalse, Córdoba, Argentina · 780m ASL  
> **Hardware:** ESP32-C3 · SHT31 · BMP180 · INA219 ×2 · CN3791 MPPT · Panel 12V 5.2W · LiPo 1500mAh  
> **Backend:** MQTT → N8N → InfluxDB → Grafana (o frontend custom)

---

## 1. Datos RAW — enviados desde el ESP32 por MQTT

| # | Variable | Sensor | Unidad | Rango típico | Notas |
|---|---|---|---|---|---|
| 1 | Temperatura ambiente | SHT31 | °C | -10 a +50 | Sensor primario de temperatura |
| 2 | Humedad relativa | SHT31 | % | 0 – 100 | Alta precisión (±2%) |
| 3 | Temperatura referencia | BMP180 | °C | -10 a +50 | Cross-check con SHT31 |
| 4 | Presión barométrica absoluta | BMP180 | hPa | ~920 – 940 | Presión real a 780m ASL |
| 5 | Presión QNH (nivel del mar) | BMP180 calc. | hPa | ~1000 – 1030 | Comparable con otras estaciones |
| 6 | Voltaje batería | INA219 #1 (0x41) | V | 3.0 – 4.2 | Lado carga (BAT → ESP32) |
| 7 | Corriente consumo sistema | INA219 #1 (0x41) | mA | 0.01 – 150 | Lo que consume el ESP32+sensores |
| 8 | Voltaje panel solar | INA219 #2 (0x40) | V | 0 – 14 | Lado producción (Panel → CN3791) |
| 9 | Corriente producción solar | INA219 #2 (0x40) | mA | 0 – 450 | Corriente entregada por el panel |
| 10 | RSSI WiFi | ESP32 interno | dBm | -30 a -90 | Calidad de señal de red |
| 11 | Timestamp | NTP | Unix ms | — | Sincronizado por red |

---

## 2. Datos DERIVADOS — calculados en N8N/backend antes de guardar en InfluxDB

### 2.1 Meteorológicos

| # | Variable | Fórmula / Fuente | Unidad | Utilidad |
|---|---|---|---|---|
| 12 | Punto de rocío | Magnus: `Td = (243.04 × (ln(HR/100) + 17.625×T/(243.04+T))) / (17.625 - (ln(HR/100) + 17.625×T/(243.04+T)))` | °C | Predice niebla/condensación. Crítico en zona del embalse |
| 13 | Índice de calor (sensación térmica) | Steadman: combina T + HR | °C | Confort térmico real |
| 14 | Temperatura promedio cruzada | `(T_SHT31 + T_BMP180) / 2` | °C | Validación cruzada de sensores |
| 15 | Delta temperatura sensores | `T_SHT31 - T_BMP180` | °C | Alertar si difieren más de 2°C → fallo de sensor |
| 16 | Tendencia de presión (3h) | `P_ahora - P_hace_3h` | hPa | ↑ mejora / ↓ empeora el tiempo. Patrón clásico de meteorología |
| 17 | Tendencia de presión (24h) | `P_ahora - P_hace_24h` | hPa | Tendencia diaria |

### 2.2 Energéticos

| # | Variable | Fórmula | Unidad | Utilidad |
|---|---|---|---|---|
| 18 | Potencia consumo sistema | `V_bat × I_consumo` | mW | Lo que gasta el sistema en este momento |
| 19 | Potencia producción solar | `V_panel × I_panel` | mW | Lo que entrega el panel ahora |
| 20 | Balance energético instantáneo | `P_produccion - P_consumo` | mW | **Positivo** = cargando · **Negativo** = descargando |
| 21 | Energía producida en el día | `∫ P_produccion dt` (integración N8N) | Wh | Acumulado desde medianoche |
| 22 | Energía consumida en el día | `∫ P_consumo dt` (integración N8N) | Wh | Acumulado desde medianoche |
| 23 | Balance energético del día | `Wh_producidos - Wh_consumidos` | Wh | Superávit o déficit del día |
| 24 | Estado de carga batería (SOC) | Lookup table voltaje → % | % | 4.2V=100% · 3.8V≈50% · 3.4V≈10% |
| 25 | Estado batería | Thresholds sobre SOC | enum | `FULL / GOOD / LOW / CRITICAL` |
| 26 | Autonomía estimada | `capacidad_restante_mAh / I_consumo_mA` | horas | Cuánto dura la batería si el panel deja de producir |
| 27 | Eficiencia del sistema | `P_consumo / P_produccion × 100` | % | Pérdidas del step-up + CN3791 |

### 2.3 Irradiancia solar estimada

| # | Variable | Fórmula | Unidad | Utilidad |
|---|---|---|---|---|
| 28 | Irradiancia estimada | `(P_panel_W / 5.2) × 1000` | W/m² | Aproximación razonable. 0 W/m² = noche · 1000 W/m² = sol pleno |
| 29 | Fracción de cielo despejado | `irradiancia / irradiancia_max_teorica_horaria` | % | Compara con el máximo teórico para esa hora y época del año |
| 30 | Índice UV estimado | Correlación empírica con irradiancia | índice 0-11 | Aproximación sin sensor UV dedicado |

---

## 3. Métricas históricas — calculadas sobre series temporales en InfluxDB

| # | Variable | Ventana temporal | Utilidad |
|---|---|---|---|
| 31 | Temperatura máxima / mínima | Diaria, semanal, mensual | Histórico climático |
| 32 | Humedad máxima / mínima | Diaria, semanal, mensual | Histórico climático |
| 33 | Presión máxima / mínima | Diaria, semanal, mensual | Histórico climático |
| 34 | Horas de sol efectivas | Diaria | Días con irradiancia > 200 W/m² |
| 35 | Energía solar captada | Diaria, semanal, mensual | Performance del sistema solar |
| 36 | Ciclos de carga batería | Histórico | Salud de la batería a largo plazo |
| 37 | Temperatura promedio mensual | Mensual | Comparación interanual |
| 38 | Días con déficit energético | Mensual | Validar dimensionamiento del sistema |

---

## 4. Alertas sugeridas

| Condición | Trigger | Acción |
|---|---|---|
| Batería CRITICAL | SOC < 10% | Notificación push / email |
| Déficit prolongado | Balance negativo > 6h | Advertencia |
| Sensor offline | No hay dato hace > 2× intervalo | Alerta crítica |
| Delta temperatura alto | `\|T_SHT31 - T_BMP180\|` > 3°C | Posible fallo de sensor |
| Caída de presión rápida | Tendencia 3h < -3 hPa | "Se viene mal tiempo" |
| Panel sin producción (de día) | Irradiancia < 10 W/m² con luz | Panel sucio o sombreado |
| RSSI bajo | RSSI < -80 dBm | Problema de conectividad |

---

## 5. Ideas para visualización (para el frontend)

### Widgets de alto impacto
- **Gauge animado de batería** con gradiente de color: verde → amarillo → rojo según SOC
- **Curva solar del día** — gráfico de irradiancia hora a hora con área rellena. En días despejados forma una campana perfecta
- **Balance energético en tiempo real** — número grande con color dinámico y flecha (↑ cargando / ↓ descargando)
- **Mapa de calor de temperatura** — grilla día × hora del mes. Patrón visual inmediato de fríos y calores
- **Tendencia de presión con ícono de clima** — ↑↑ sol · ↑ mejorando · → estable · ↓ empeorando · ↓↓ tormenta

### Correlaciones interesantes para graficar
- Temperatura vs. Irradiancia (mismo eje temporal) — se ve el lag térmico del día
- Punto de rocío vs. Temperatura — cuando se cruzan hay niebla
- Voltaje batería vs. Horas del día — el ciclo carga/descarga es visualmente satisfactorio
- Eficiencia del sistema a lo largo del tiempo — detecta degradación del panel o batería

---

*Documento generado para estación WELT-406 · Embalse, Córdoba · Marzo 2026*