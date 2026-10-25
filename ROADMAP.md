# Roadmap de Chinchero

Lista de tareas para avanzar de a una. Cada tarea se hace en una sesión de chat, se prueba, se marca aquí y se sube con commit + push. Después se limpia el chat (`/clear`) y se sigue con «seguí con el Roadmap».

## Cómo trabajar una tarea

1. Tomar la **primera tarea pendiente** (la de más arriba en «Pendientes»).
2. Implementarla en `app/` (o `web/`), siguiendo el estilo del código existente.
3. Probar: `cd app && npm test` (más pruebas nuevas si la tarea lo pide). Si toca la interfaz, revisar capturas en `app/tests/out/`.
4. Actualizar este archivo: mover la tarea a «Hecho» con la fecha y una línea de qué se hizo. Anotar decisiones o pendientes que surjan. Actualizar también `dashboard/tasks.json` (estado, subtareas, horas, registro): se ve en vivo con `node dashboard/server.js` → http://localhost:5179.
5. Commit con mensaje convencional (`feat: …`, `fix: …`, `docs: …`) y `git push`.
6. Avisar al usuario que puede hacer `/clear` y decir «seguí con el Roadmap».

## Estado actual (2026-10-24)

- App Electron funcional: tableros, hojas, grupos, papelera, ajustes, bienvenida, tutoriales y sugerencias. Guarda en disco (`Documentos\Chinchero`), copia imágenes y archivos a `media/`, exporta PNG, se actualiza desde GitHub Releases.
- Instalador NSIS verificado localmente (`npm run dist`).
- Web estática en `web/` con animaciones, capturas reales y descargas leídas de la API de GitHub.
- Sin dependencias de internet: fuentes incluidas en el proyecto.
- Pruebas: `app/tests/e2e-ui.js` (46 casos de interfaz), `e2e-app.js` (12 casos con la app real), `offline-fonts.js`.

## Pendientes

### 1. Plantilla «Semana» y atajos de grupo
- Nueva plantilla «Semana / Planificador»: zonas de Lunes a Domingo en columnas + zona «Ideas de la semana» y una lista de pendientes. Disponible en el modal de nuevo tablero, en la hoja en blanco y en Ctrl+K.
- Añadir **Ctrl+U** como atajo alternativo de Desagrupar (se mantiene Ctrl+Shift+G). Fuera de la edición de texto, para no chocar con el subrayado.
- Pegado de imágenes: Ctrl+V pega como polaroid (como hoy) y **Ctrl+Shift+V** como foto sin marco.

### 2. Exportación en alta resolución (PNG y PDF)
- Hoy «Exportar PNG» captura solo el área visible a la resolución de pantalla.
- Exportar **toda la hoja** (encuadrada, sin la interfaz) a PNG en 2x, aunque no entre en pantalla: capturar por partes o renderizar en una ventana oculta del tamaño del contenido.
- Exportar a **PDF** la hoja actual o todas las hojas (una página por hoja) con `printToPDF`.
- Mantener «Copiar como imagen» (para pegar en WhatsApp o documentos) usando la misma captura de alta resolución.

### 3. Copias de seguridad en .zip y robustez de datos
- Hoy «Hacer copia» copia la carpeta tal cual. Pasar a **un solo archivo `.zip`** (librería pura en JS, p. ej. `fflate`, sin depender de internet).
- «Restaurar copia (.zip)» en Ajustes → Datos.
- Copias automáticas al abrir la app (últimas 5 en `backups/` dentro de la carpeta de datos).
- Si `library.json` o un tablero no se pueden leer, recuperar desde la última copia y avisar.

### 4. Compartir un tablero (.zip)
- En el menú de cada tablero: «Exportar tablero…» genera un `.chinchero` (zip con el JSON del tablero + sus imágenes y archivos).
- En Tableros: «Importar tablero…» y arrastrar el archivo a la ventana; crea un tablero nuevo (ids nuevos, imágenes copiadas a `media/`).
- Asociar la extensión `.chinchero` en el instalador para abrir con doble clic.

### 5. Sonidos de interacción (opcional, apagados por defecto)
- Interruptor en Ajustes → Apariencia: «Sonidos de interacción» y volumen.
- Sonidos sutiles: clic de chinche al clavar, roce de papel al soltar una nota, cinta al fijar, «tic» al tachar una tarea.
- Generarlos con Web Audio (síntesis) o con archivos propios dentro del proyecto: nada se descarga de internet y no hay problemas de licencia.
- Respetar el volumen del sistema y no sonar al deshacer en ráfaga.

### 6. Rendimiento con tableros grandes
- Hoy `render()` reconstruye todo el DOM de la hoja en cada cambio. Pasar a render incremental (solo los elementos que cambian).
- Generar miniaturas reducidas de las imágenes al importarlas (`media/thumbs/`) y usarlas en el lienzo; la original solo en el visor.
- Crear una prueba de carga: 500 elementos y 100 fotos. Objetivo: arrastrar y hacer zoom sin tirones, abrir el tablero en menos de 1 s.

### 7. Seguridad de Electron
- Activar los «fuses» de Electron (desactivar `RunAsNode`, `--inspect`, `NODE_OPTIONS`; verificar integridad del asar).
- Content-Security-Policy en las pantallas (solo recursos locales y `chinchero-media:`).
- Validar los argumentos de cada IPC en el proceso principal.

### 8. Liberar espacio
- En Ajustes → Datos: detectar imágenes y archivos de `media/` que ningún tablero usa y ofrecer borrarlos.

### 9. Accesibilidad
- Anunciar con `aria-live` lo que pasa en el lienzo (creado, movido, eliminado).
- Revisar contraste en ambos temas y navegación completa con teclado.

### 10. QA y revisión de UX/UI de toda la app
- Recorrer todas las pantallas (bienvenida, tableros, editor, ajustes, papelera, modales, menús, Ctrl+K, tutoriales) en tema claro y oscuro, y a distintos tamaños de ventana.
- Buscar fallos de funcionamiento: acciones que no responden, estados sin feedback, errores en consola, datos que no se guardan.
- Buscar errores visuales: alineaciones, espaciados irregulares, textos cortados o desbordados, iconos desalineados.
- Detectar espacios vacíos o mal aprovechados y proponer mejoras de distribución.
- Dejar un informe con capturas (`app/tests/out/`) y una lista priorizada; arreglar lo pequeño en la misma tarea y convertir lo grande en tareas nuevas del roadmap.

### Opcionales (sin orden)
- Firma de código para evitar el aviso de SmartScreen (de pago: certificado OV/EV o Azure Trusted Signing).
- Dominio propio para la web.
- Versión para macOS / Linux.

## Ideas revisadas que ya están hechas

- **Espacio + arrastrar para mover el lienzo** (también rueda del ratón, botón central y arrastrar el fondo). El cursor pasa a mano.
- **Pegado inteligente con Ctrl+V** donde está el ratón: imagen → foto polaroid (copiada a `media/`), URL → tarjeta de enlace, texto → nota adhesiva, elemento copiado de Chinchero → copia del elemento. Funciona con capturas de Win+Shift+S.
- **Agrupar Ctrl+G / Desagrupar Ctrl+Shift+G** sobre la selección múltiple, con recuadro de grupo y Ctrl+clic para elegir un elemento dentro del grupo.
- **Exportar PNG real** de la vista actual y «Copiar como imagen» (la alta resolución y el PDF son la tarea 3).

## Hecho

- **2026-10-24 · Base del proyecto**: mockups y QA en `design/` (solo local, fuera del repo), app Electron con persistencia, instalador y actualizaciones, web del producto, flujos de GitHub Actions, fuentes locales, pruebas automáticas, nombre definitivo «Chinchero».
- **2026-10-25 · Primera versión (v0.1.0)**: web en GitHub Pages, release v0.1.0 con `Chinchero-Setup-0.1.0.exe`, `.blockmap` y `latest.yml`; la web muestra la versión y descarga el instalador. Instalación revisada (accesos directos, primer inicio). `release.yml` ahora compila con `--publish never` y publica con `gh release create`, porque electron-builder creó dos releases con la misma etiqueta al subir en paralelo. Las pruebas con Edge hay que lanzarlas desde PowerShell (en Git Bash Edge no arranca).
- **2026-10-25 · Actualización automática (v0.1.1 → v0.1.3)**: 0.1.0 → 0.1.1 funcionó, pero «Reiniciar ahora» no daba feedback y abría el asistente de NSIS. Desde 0.1.2 la actualización se descarga en segundo plano y se instala en silencio al cerrar o con «Reiniciar ahora», que ahora muestra «Instalando…». El banner se mantiene entre pantallas y, si se cierra, no insiste. 0.1.2 → 0.1.3 verificada. Las notas de cada release salen de `app/notas/vX.Y.Z.md`. Desinstalar respeta la carpeta de datos. Con instalación «para todos los usuarios», Windows pide permiso (UAC) en cada actualización.
