# Roadmap de Chinchero

Lista de tareas para avanzar de a una. Cada tarea se hace en una sesión de chat, se prueba, se marca aquí y se sube con commit + push. Después se limpia el chat (`/clear`) y se sigue con «seguí con el Roadmap».

## Cómo trabajar una tarea

1. Tomar la **primera tarea pendiente** (la de más arriba en «Pendientes»).
2. Implementarla en `app/` (o `web/`), siguiendo el estilo del código existente.
3. Probar: `cd app && npm test` (más pruebas nuevas si la tarea lo pide). Si toca la interfaz, revisar capturas en `app/tests/out/`.
4. Actualizar este archivo: mover la tarea a «Hecho» con la fecha y una línea de qué se hizo. Anotar decisiones o pendientes que surjan.
5. Commit con mensaje convencional (`feat: …`, `fix: …`, `docs: …`) y `git push`.
6. Avisar al usuario que puede hacer `/clear` y decir «seguí con el Roadmap».

## Estado actual (2026-10-24)

- App Electron funcional: tableros, hojas, grupos, papelera, ajustes, bienvenida, tutoriales y sugerencias. Guarda en disco (`Documentos\Chinchero`), copia imágenes y archivos a `media/`, exporta PNG, se actualiza desde GitHub Releases.
- Instalador NSIS verificado localmente (`npm run dist`).
- Web estática en `web/` con animaciones, capturas reales y descargas leídas de la API de GitHub.
- Sin dependencias de internet: fuentes incluidas en el proyecto.
- Pruebas: `app/tests/e2e-ui.js` (46 casos de interfaz), `e2e-app.js` (12 casos con la app real), `offline-fonts.js`.

## Pendientes

### 1. Publicar la primera versión (v0.1.0)
- Activar GitHub Pages con fuente «GitHub Actions» (Settings → Pages) y comprobar que la web se publica.
- Crear la etiqueta `v0.1.0`, comprobar que `release.yml` termina bien y que la release tiene `Chinchero-Setup-0.1.0.exe` y `latest.yml`.
- Comprobar en la web que aparece la versión y que el botón descarga el instalador.
- Instalar en Windows y revisar: accesos directos, primer inicio, desinstalar sin perder datos.

### 2. Verificar la actualización automática
- Con v0.1.0 instalada, publicar `v0.1.1` (cambio mínimo + notas de versión).
- Comprobar el aviso «Descargando…», el banner «Reiniciar ahora» y que tras reiniciar queda en 0.1.1.
- Revisar «Buscar actualizaciones» en Ajustes con y sin conexión.

### 3. Rendimiento con tableros grandes
- Hoy `render()` reconstruye todo el DOM de la hoja en cada cambio. Pasar a render incremental (solo los elementos que cambian).
- Generar miniaturas reducidas de las imágenes al importarlas (`media/thumbs/`) y usarlas en el lienzo; la original solo en el visor.
- Crear una prueba de carga: 500 elementos y 100 fotos. Objetivo: arrastrar y hacer zoom sin tirones, abrir el tablero en menos de 1 s.

### 4. Robustez de los datos
- Copias automáticas al abrir la app (últimas 5 en `backups/` dentro de la carpeta de datos).
- Si `library.json` o un tablero no se pueden leer, recuperar desde la última copia y avisar.
- Botón en Ajustes para restaurar una copia automática.

### 5. Seguridad de Electron
- Activar los «fuses» de Electron (desactivar `RunAsNode`, `--inspect`, `NODE_OPTIONS`; verificar integridad del asar).
- Content-Security-Policy en las pantallas (solo recursos locales y `chinchero-media:`).
- Validar los argumentos de cada IPC en el proceso principal.

### 6. Compartir un tablero
- Exportar un tablero a un archivo `.chinchero` (JSON + imágenes en un zip) e importarlo desde la pantalla de Tableros.
- Asociar la extensión `.chinchero` al instalador para abrir con doble clic.

### 7. Exportar a PDF
- Exportar la hoja actual o todas las hojas a PDF (una página por hoja, encuadrada).

### 8. Liberar espacio
- En Ajustes → Datos: detectar imágenes y archivos de `media/` que ningún tablero usa y ofrecer borrarlos.

### 9. Accesibilidad
- Anunciar con `aria-live` lo que pasa en el lienzo (creado, movido, eliminado).
- Revisar contraste en ambos temas y navegación completa con teclado.

### 10. Ordenar el repositorio
- Decidir qué hacer con `design/mockups` (archivar o borrar): la app (`app/src/renderer`) ya es la fuente de verdad.

### Opcionales (sin orden)
- Firma de código para evitar el aviso de SmartScreen (de pago: certificado OV/EV o Azure Trusted Signing).
- Dominio propio para la web.
- Versión para macOS / Linux.

## Hecho

- **2026-10-24 · Base del proyecto**: mockups y QA en `design/`, app Electron con persistencia, instalador y actualizaciones, web del producto, flujos de GitHub Actions, fuentes locales, pruebas automáticas, nombre definitivo «Chinchero».
