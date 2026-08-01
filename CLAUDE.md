# frontend-dashboard

Repo **secondary** del proyecto Weather Station (ver [`../CLAUDE.md`](../CLAUDE.md) para contexto general, topología de repos y política de commits/push — aplica igual acá).

Dashboard en React + Vite que consume la API de `backend-service`. Ver `backend_api_specs.md` y `datos_backend.md` en este mismo repo para el contrato con el backend. Se dockeriza con el `Dockerfile` de este repo y se despliega junto al backend vía el `docker-compose.yml` de la raíz del proyecto (imagen `maulpdocker/weather-station:frontend`, servida por nginx — ver `nginx.conf`).

## Vistas

`App.jsx` cambia de vista con un `useState` (`dashboard` | `calendar` | `service`), sin router — mantener ese patrón salvo que haga falta deep-linking.

`components/service/` es la vista de **service mode**: el flujo de OTA/mantenimiento del nodo ESP32. Se alimenta del stream SSE de `/api/v1/service/stream` vía `services/ServiceApi.js`. Dos cosas a respetar si se toca:

- **El paso del wizard se deriva del estado del nodo**, no se guarda como paso local. El nodo es quien manda: lee el comando retenido recién al despertar y anuncia service mode por el topic de status. Un stepper manual se desincroniza del hardware.
- **El color nunca comunica solo**: cada estado lleva ícono y texto. El verde y el ámbar de este dashboard se separan apenas ΔE 6.8 bajo protanopia, así que el matiz por sí solo no es legible.

`nginx.conf` desactiva `proxy_buffering` en `/api` — sin eso el SSE queda retenido en el buffer y el visor de payloads parece congelado.

## Versionado

La versión del dashboard es el campo **`version` de `package.json`, y no hay otra copia**. Bumpearla es editar ese campo o correr `npm version patch|minor|major`.

`vite.config.js` la lee en build y la inyecta como la constante global `__APP_VERSION__` (declarada en `eslint.config.js` para que no sea un `no-undef`). El browser no puede leer el `package.json` en runtime, y tener el número escrito también en un `.js` sería una segunda fuente de verdad que se desincroniza en el primer release apurado.

`components/VersionBadge.jsx` la muestra en la esquina inferior derecha junto a la del backend, que pide a `GET /api/v1/version`. Si el backend no contesta —o es viejo y no tiene el endpoint— muestra `—` en vez de desaparecer: "el backend no contestó" tiene que leerse distinto de "están en la misma versión", que es justo lo que esa línea existe para decir.

Backend y frontend **se versionan por separado** y se despliegan como imágenes independientes; el firmware lleva la suya y se ve en service mode.
