# Chinchero — Diseño

Tablero tipo corcho para Windows: notas, fotos, stickers y listas fijadas con chinches o cinta, unidas con hilos, organizadas en grupos de tableros y hojas.

## Flujo de trabajo

1. **Mockups** (`design/mockups/`): HTML + JS sin build. Se abren con doble clic en el navegador.
2. **Iterar**: revisar cada vista, anotar cambios en "Decisiones abiertas", actualizar el HTML.
3. **Congelar**: sin decisiones abiertas, los mockups son la especificación visual y de interacción.
4. **App Windows**: elegir stack y construir.

## Vistas

| # | Archivo | Qué cubre |
|---|---------|-----------|
| — | `mockups/index.html` | Índice de vistas |
| 00 | `mockups/00-bienvenida.html` | Primer inicio: tema, carpeta de datos (o abrir existentes), primer tablero, tutoriales sí/no |
| 01 | `mockups/01-tableros.html` | Grupos, Recientes, Favoritos, búsqueda, orden, mover arrastrando, plantillas, sugerencias (`?group=<id>` / `?view=recent\|fav`) |
| 02 | `mockups/02-tablero.html` | Editor (`?template=blank\|detective\|kanban\|moodboard\|viaje&name=…&surface=…`) |
| 03 | `mockups/03-ajustes.html` | Apariencia, tablero, datos, ayuda, atajos, acerca de |
| 04 | `mockups/04-papelera.html` | Restaurar o eliminar definitivamente |

Compartido en `mockups/assets/`:
- `theme.css` / `theme.js`: tokens, fondos, chinche, tooltips, tutorial, sugerencias; tema y preferencias (`getPref`/`setPref`).
- `ui.js`: menú contextual (`showMenu`) y aviso con "Deshacer" (`toast`).
- `guide.js`: tutoriales guiados (`Tour`), sugerencias (`Tips`), menú de ayuda y panel de atajos.
- `shell.css` + `sidebar.js`: layout con barra lateral (01, 03, 04).
- `editor.css` + `editor.js`: el editor. Estado en un modelo (`doc → hojas → elementos + hilos`); el DOM se genera desde él, lo que permite deshacer, copiar/pegar y plantillas.

## Modelo conceptual

- **Grupo** → **tableros** → **hojas** (pestañas abajo). Cada hoja es un lienzo con su propio **fondo**.
- **Elementos**: nota, ficha, lista de tareas, texto, foto, enlace, archivo, sticker (emoji o imagen propia), sello, **zona**, dibujo.
- **Fijación**: chinche (color y posición editables) o cinta. Texto: chinche opcional. Stickers, sellos, zonas y dibujos no llevan.
- **Hilo**: une dos chinches; tiene color, etiqueta y tensión. Una chinche por elemento (decisión: simplifica los hilos).
- **Zona**: rectángulo con título detrás de los elementos; al moverla arrastra lo que tiene dentro.
- **Datos**: carpeta portable junto al .exe; las imágenes se copian dentro. Guardado automático con indicador.

## Ayuda al usuario

- **Tutoriales guiados** en cada vista: aparecen la primera vez, se repiten desde el botón **?**. El del editor es interactivo (avanza cuando creas una nota, la mueves o tiendes un hilo).
- **Sugerencias** contextuales (una a la vez, cada una una sola vez): p. ej. al tener 3+ elementos con chinche y ningún hilo, al borrar (Ctrl+Z), al crear 3 iguales seguidos (fijar herramienta).
- **Estados vacíos** con acciones sugeridas (hoja en blanco → nota, imagen, plantillas).
- Todo se desactiva en Ajustes → Ayuda o desde el menú **?**.

## Decisiones abiertas

- [ ] ¿"Grupo de tableros" y "hojas" como dos niveles (actual) o uno solo?
- [ ] Stack para Windows. Recomendación actual: **Electron** con instalador NSIS y actualizaciones automáticas (prioridad: estabilidad bajo carga e instalable; el peso no importa).
- [ ] ¿Sincronización entre equipos más adelante (carpeta en OneDrive vs. servidor propio)?
- [ ] Exportar a PNG/PDF: hoy solo simulado en el mockup.

## QA

Hallazgos y estado: [QA.md](QA.md).
