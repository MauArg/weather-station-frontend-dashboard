# frontend-dashboard

Repo **secondary** del proyecto Weather Station (ver [`../CLAUDE.md`](../CLAUDE.md) para contexto general, topología de repos y política de commits/push — aplica igual acá).

Dashboard en React + Vite que consume la API de `backend-service`. Ver `backend_api_specs.md` y `datos_backend.md` en este mismo repo para el contrato con el backend. Se dockeriza con el `Dockerfile` de este repo y se despliega junto al backend vía el `docker-compose.yml` de la raíz del proyecto (imagen `maulpdocker/weather-station:frontend`, servida por nginx — ver `nginx.conf`).
