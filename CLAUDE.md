# frontend-dashboard

Repo **secondary** del proyecto Weather Station (ver [`../CLAUDE.md`](../CLAUDE.md) para contexto general, topología de repos y política de commits/push — aplica igual acá).

Dashboard en React + Vite que consume la API de `backend-service`. Ver `backend_api_specs.md` y `datos_backend.md` en este mismo repo para el contrato con el backend. Se dockeriza con el `Dockerfile` de este repo y se despliega junto al backend vía el `docker-compose.yml` de la raíz del proyecto (imagen `maulpdocker/weather-station:frontend`, servida por nginx — ver `nginx.conf`).

## Vistas

`App.jsx` cambia de vista con un `useState` (`dashboard` | `calendar` | `service`), sin router — mantener ese patrón salvo que haga falta deep-linking.

`components/service/` es la vista de **service mode**: el flujo de OTA/mantenimiento del nodo ESP32. Se alimenta del stream SSE de `/api/v1/service/stream` vía `services/ServiceApi.js`. Dos cosas a respetar si se toca:

- **El paso del wizard se deriva del estado del nodo**, no se guarda como paso local. El nodo es quien manda: lee el comando retenido recién al despertar y anuncia service mode por el topic de status. Un stepper manual se desincroniza del hardware.
- **El color nunca comunica solo**: cada estado lleva ícono y texto. El verde y el ámbar de este dashboard se separan apenas ΔE 6.8 bajo protanopia, así que el matiz por sí solo no es legible.

`nginx.conf` desactiva `proxy_buffering` en `/api` — sin eso el SSE queda retenido en el buffer y el visor de payloads parece congelado.

## Idioma (i18n)

EN/ES con `react-i18next`. La capa vive en `src/i18n/`; los diccionarios en `src/i18n/locales/{en,es}/`, un archivo por namespace. **Inglés es el idioma fuente y el fallback** — es el que está garantizado completo.

Cinco namespaces, y la división que importa es `api` contra el resto:

- `common`, `dashboard`, `calendar`, `service` — texto que nace en este repo.
- **`api`** — códigos acuñados **afuera**: por el backend (`internal/models/i18n.go`) y por la tabla `LOG_CODES` del firmware. Agregar una clave acá significa que cambió otro repo. Por eso el `missingKeyHandler` **exime a `api`**: que falte un código es el caso esperado cuando el firmware o el backend van adelante, y avisar de eso entrena a ignorar el warning.

**La regla, en todos lados: traducir por código, con fallback a la prosa que mandó el emisor.** Está en `src/i18n/apiText.js` (`apiText` / `apiNote` / `commandNote` / `commandToast`) y no se reimplementa a mano. Es lo que hace que el cambio de API sea aditivo: backend, dashboard y nodo se despliegan con sus propios tiempos, así que en cualquier momento uno puede estar adelantado, y un código desconocido renderiza la oración que llegó con él en vez de un hueco.

Tres cosas que la capa deliberadamente **no** hace:

- **No toca el formato de números ni de fechas.** Eso vive en `src/utils/timezone.js`, fijo en `es-AR` / `America/Argentina/Buenos_Aires` **en los dos idiomas**: la estación está en Argentina y el backend corta sus días en medianoche local, así que ART y el reloj de 24 h son propiedades del dato. Sólo cambian las palabras. Ojo con dos trampas ya pisadas: `es-AR` con `hour` explícito resuelve a 12 h en Chrome (de ahí el `hourCycle: 'h23'`), y `toFixed()` siempre emite punto — usar `formatFixed`.
- **No llega al firmware.** `_dictFingerprint()` hashea los templates de `LOG_CODES`, así que editarlos resetea el ring de logs en RTC. Se traducen acá, y **la traducción sólo vale para el template contra el que fue escrita**: `LogPanel` compara el template del firmware —que viaja en cada captura— contra el original inglés del nuestro, y si difieren gana el renderizado del nodo.
- **No traduce `broker.lastError` ni `logs.lastError`.** Son strings crudos de paho y de la red; para quien debuggea el mensaje textual vale más.

Al tocar los diccionarios, chequear **paridad de claves, de markup y de placeholders entre `en` y `es`** — un desajuste cae al fallback en silencio. Y `count` es el selector de plural de i18next: no usarlo para cantidades decimales.

## Versionado

La versión del dashboard es el campo **`version` de `package.json`, y no hay otra copia**. Bumpearla es editar ese campo o correr `npm version patch|minor|major`.

`vite.config.js` la lee en build y la inyecta como la constante global `__APP_VERSION__` (declarada en `eslint.config.js` para que no sea un `no-undef`). El browser no puede leer el `package.json` en runtime, y tener el número escrito también en un `.js` sería una segunda fuente de verdad que se desincroniza en el primer release apurado.

`components/VersionBadge.jsx` la muestra en la esquina inferior derecha junto a la del backend, que pide a `GET /api/v1/version`. Si el backend no contesta —o es viejo y no tiene el endpoint— muestra `—` en vez de desaparecer: "el backend no contestó" tiene que leerse distinto de "están en la misma versión", que es justo lo que esa línea existe para decir.

Backend y frontend **se versionan por separado** y se despliegan como imágenes independientes; el firmware lleva la suya y se ve en service mode.

> **Bumpear es el último paso antes de rebuildear, no el primero después.** La imagen se publica con tag mutable, así que nada fuerza que el número suba cuando cambia el bundle. Ya se pasó por alto una vez. Si la tanda tocó este repo, la versión sube.
