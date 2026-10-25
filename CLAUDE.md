# Chinchero — guía para Claude

App de escritorio para Windows (Electron) tipo tablero de corcho: notas, fotos, stickers y archivos unidos con hilos. Más una web estática del producto. Repo: https://github.com/MaxLezano/Chinchero

## Al empezar una sesión

- Si el usuario dice «seguí con el Roadmap» (o similar): leer `ROADMAP.md`, tomar la primera tarea de «Pendientes» y seguir los pasos de «Cómo trabajar una tarea».
- Al terminar una tarea: actualizar `ROADMAP.md`, commit convencional y `git push`, y avisar que puede hacer `/clear`.
- Dashboard del roadmap (`dashboard/`, **solo local**, está en `.gitignore`; `node dashboard/server.js` → http://localhost:5179): mantener `dashboard/tasks.json` al día durante la tarea. Al empezar, `estado: "en-proceso"` e `inicio`; al cumplir cada subtarea, `hecha: true`; al terminar, `estado: "hecha"`, `fin` y `horasReales`. Añadir una línea a `registro` y actualizar `actualizado` (ISO) en cada cambio. Si el servidor está corriendo, la página se refresca sola. Tareas nuevas del ROADMAP también van aquí, con `horasEstimadas`.

## Estructura

- `app/src/main/` proceso principal: `main.js` (ventana, IPC, protocolo `chinchero-media://`), `store.js` (disco), `updater.js` (electron-updater).
- `app/src/preload/preload.js`: API `window.chinchero` (lecturas síncronas, escrituras asíncronas).
- `app/src/renderer/`: pantallas `00-bienvenida` … `04-papelera`. `assets/store.js` es la capa de datos (usa `window.chinchero` en la app y `localStorage` en un navegador, para probar sin Electron). El editor está en `assets/editor.js` + `editor.css`: modelo `doc → hojas → elementos + hilos`, el DOM se genera desde el modelo.
- `web/`: sitio estático (GitHub Pages). `assets/site.js` lee las releases de la API de GitHub.
- `design/`: mockups originales y QA. **Solo local** (está en `.gitignore`, no se sube al repo); usarla como referencia, no como fuente de verdad.

## Reglas del proyecto

- Interfaz en español neutro («Haz clic»); comentarios del código en español.
- Nada se carga de internet en la app: fuentes y recursos van dentro del proyecto (`assets/fonts`).
- Datos del usuario en `Documentos\Chinchero`; nunca borrarlos al desinstalar.
- Commits: mensajes convencionales, sin líneas de coautoría.

## Comandos

```bash
cd app && npm start      # quitar antes ELECTRON_RUN_AS_NODE si existe (VS Code la define)
cd app && npm test       # e2e-ui (Edge + localStorage), e2e-app (Electron real, perfil aislado), offline-fonts
cd app && npm run dist   # instalador en app/dist/
```

Las pruebas usan `puppeteer-core` con Microsoft Edge instalado (`EDGE_PATH` para otra ruta). `e2e-app.js` lanza Electron con `CHINCHERO_USER_DATA` y `CHINCHERO_DATA_DIR` en `app/tests/out/` para no tocar datos reales.
