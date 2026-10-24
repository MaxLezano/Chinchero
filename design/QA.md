# QA + UX/UI — Mockups

## v3.1 — feedback del usuario (2026-10-24)

- **Girar**: se arrastra junto a cualquier esquina (cursor de giro, Shift = 15°). Se quitó el asa superior.
- **Doble clic**: solo edita el elemento. En un hueco ya no crea una nota.
- **Ctrl+C / Ctrl+V**: copia el elemento aunque el portapapeles del sistema tenga una imagen, mientras la ventana no haya perdido el foco.
- **Navegación**:
  - arrastrar el fondo mueve el lienzo;
  - la rueda hace zoom hacia el puntero;
  - Shift+arrastrar selecciona con recuadro;
  - se eliminaron las herramientas Seleccionar y Mano.
- **Stickers**: la caja tiene márgenes parejos.
- **Corcho**:
  - textura procedural generada por código (gránulos irregulares en un canvas que se repite sin costuras), sin archivos de imagen;
  - se probaron gradientes CSS puros, pero dejaban una cuadrícula visible.
- 41 pruebas automáticas en verde.

## Estado v3 (2026-10-24)

Verificado con 36 pruebas automáticas en Edge (puppeteer) más revisión de capturas en claro, oscuro y corcho. Sin errores de consola.

- **Bugs B1–B10**: resueltos.
- **U1–U15**: resueltos, salvo dos simulados (sin implementación real en el mockup):
  - U7: exportar abre un menú que solo muestra un aviso.
  - U13: los stickers propios se importan solo en memoria.
- **3b. Interacciones por elemento**: todo resuelto, salvo dos decisiones:
  - **una chinche por elemento** (simplifica los hilos);
  - **móvil fuera de alcance**.
- **Elementos nuevos**: zona, ficha, enlace, archivo y dibujo.
- **Nuevos bugs encontrados y resueltos en esta ronda**:
  - el tutorial rompía el layout con barra lateral;
  - los extremos de un hilo tapaban la chinche;
  - el área de clic de los hilos robaba clics a las notas;
  - Enter dentro de una tarea disparaba un atajo global;
  - crear con un clic perdía el foco de edición;
  - deshacer necesitaba dos pasos tras añadir una tarea;
  - el nombre del grupo se cortaba en Recientes.

---

# Ronda v2 (2026-10-24)

Revisión con Edge (puppeteer) a 1440×900 y 390×844, en tema claro y oscuro, más pruebas de interacción en el editor. No hubo errores de consola en ninguna vista.

Severidad: **P0** rompe una tarea básica · **P1** confunde o se ve mal · **P2** pulido.

---

## 1. Bugs

| # | Sev | Vista | Problema | Causa / evidencia |
|---|-----|-------|----------|-------------------|
| B1 | P0 | 02 | Doble clic en una nota, foto o lista **crea una nota nueva** encima en vez de editarla o abrir el visor. No se puede editar texto existente con doble clic. | `setPointerCapture` en `pointerdown` hace que el `dblclick` llegue con `target = viewport`. Prueba: 10 → 11 elementos tras doble clic en `n1`. |
| B2 | P1 | 02 | La barra contextual se sale de la pantalla cuando el elemento está cerca del borde derecho (se corta el botón Eliminar) y "Chinche ⇄ Cinta" se parte en dos líneas. | `placeCtx` solo limita `top`, no `left`. |
| B3 | P1 | 01, 03, 04 | El icono de Ajustes de la barra lateral se ve azul/violeta. | Es un `<a>` y hereda el color de enlace del navegador. |
| B4 | P1 | 04 | El texto "Los elementos se eliminan para siempre a los 30 días" queda tapado por la barra superior. | `margin-top: -8px` bajo un `topbar` sticky. |
| B5 | P1 | 02 | En corcho + tema oscuro, el texto suelto ("Chinchero v1") casi no se lee. | `.surface-cork .label` usa marrón oscuro sobre corcho oscuro. |
| B6 | P2 | 01 | En Recientes/Favoritos falta un espacio ("Proyecto Chinchero ·4 hojas") y el meta ocupa dos líneas, con tarjetas de distinta altura. | Concatenación en `insertAdjacentHTML`. |
| B7 | P2 | todas | El botón de tema siempre muestra la luna, aunque ya estés en oscuro. | Icono fijo. |
| B8 | P2 | 02 | La barra contextual sigue visible mientras usas la herramienta Hilo y tapa elementos. | `setTool` no deselecciona. |
| B9 | P2 | 01 | "Nuevo tablero": el nombre no viene seleccionado, Enter no crea y el fondo ignora la preferencia de Ajustes. | — |
| B10 | P2 | 01 | "Recientes" muestra lo mismo que "Todos", sin ordenar por fecha. | — |

## 2. Problemas de UX/UI

| # | Sev | Problema | Propuesta |
|---|-----|----------|-----------|
| U1 | P0 | **No hay deshacer (Ctrl+Z).** En un lienzo es imprescindible; además borrar con Supr no ofrece "Deshacer", mientras que borrar un tablero sí. | Ctrl+Z / Ctrl+Y en todo el editor; toast "Elemento eliminado · Deshacer". |
| U2 | P0 | **No se pueden redimensionar** notas, fotos ni listas. Una foto grande o una nota larga no tienen solución. | Asas de tamaño en la selección; Shift mantiene proporción en fotos. |
| U3 | P1 | **Los hilos tapan el texto** de notas y listas (se ve en "Un tablero de corcho…" y "Cerrar la idea"). | Hilos por debajo de los elementos (solo la chinche encima) u opción "Atenuar hilos"; botón para ocultar hilos. |
| U4 | P1 | **Los hilos no se pueden seleccionar.** Solo existe "Quitar hilos" (todos los del elemento). | Clic en un hilo para seleccionarlo: borrar, color, etiqueta. |
| U5 | P1 | **Sin selección múltiple** (Shift+clic o recuadro) ni mover varios a la vez. | Recuadro de selección + Shift; mover, alinear y borrar en grupo. |
| U6 | P1 | **No se ve si está guardado.** El usuario no sabe si sus cambios se guardaron. | Indicador "Guardado ✓ / Guardando…" en la barra superior. |
| U7 | P1 | El botón Exportar (icono de subir) es ambiguo y no hace nada. | Menú "Exportar hoja como PNG / PDF". |
| U8 | P1 | Herramientas solo con icono y `title` nativo: lento de descubrir para un usuario nuevo. | Tooltip propio con nombre + atajo; primer uso con 3–4 pistas (coach marks). |
| U9 | P1 | Bienvenida sin "Saltar" ni "Ya tengo datos de Chinchero" (clave en una app portable al cambiar de PC). | Enlace "Saltar" y "Abrir carpeta existente…". |
| U10 | P2 | "Mover a grupo…" es solo un aviso; no se puede arrastrar una tarjeta a un grupo de la barra lateral. | Submenú con los grupos + arrastrar y soltar a la barra lateral. |
| U11 | P2 | Las hojas no se reordenan y con muchas no hay forma de verlas todas. | Arrastrar pestañas; menú "▾ todas las hojas". |
| U12 | P2 | Las notas no tienen formato (negrita, lista) ni tamaño de letra. | Mini barra de formato al editar. |
| U13 | P2 | Los stickers son solo emojis fijos. | "Mis stickers": importar PNG propios. |
| U14 | P2 | No hay bloqueo de elementos: se mueven sin querer al desplazar el lienzo. | "Bloquear" en el menú contextual (candado). |
| U15 | P2 | Accesibilidad: botones solo-icono sin `aria-label`, letras de atajos (`kbd`) de 9px con bajo contraste, sin foco visible al usar el teclado. | Etiquetas, foco visible y `kbd` legible. |

## 3. Lo que falta para usarla de verdad

**Imprescindible (antes de construir):**
- Deshacer/rehacer (U1).
- Redimensionar elementos (U2).
- Hilos seleccionables y legibles (U3, U4).
- Selección múltiple (U5).
- Copiar/pegar elementos (Ctrl+C/V), también entre hojas y tableros.
- Búsqueda global: encontrar una nota por su texto en cualquier tablero (Ctrl+K).
- Indicador de guardado (U6).

**Importante:**
- Exportar hoja a PNG/PDF (U7).
- Minimapa o "ir a…" para tableros grandes.
- Arrastrar imágenes desde el navegador (URL), no solo archivos.
- Ajuste de la ventana de Windows: tamaño mínimo (p. ej. 900×600), barra de título propia o nativa.
- Orden de tableros (manual, nombre, fecha).

**Deseable:**
- Etiquetas en los hilos.
- Notas con formato (U12).
- Stickers propios (U13).
- Bloquear elementos (U14).
- Enlaces con vista previa y archivos adjuntos.
- Plantillas de tablero (detective, moodboard, kanban).

## 3b. Interacciones por elemento (herramientas de creación)

✓ funciona · ✗ falta · ~ parcial · — no aplica

| Acción | Nota | Foto | Lista | Texto | Sticker | Sello | Hilo |
|--------|------|------|-------|-------|---------|-------|------|
| Crear donde haces clic | ✓ | ✓ | ✗ centro | ✓ | ✗ centro | ✗ centro | ~ clic-clic |
| Editar contenido | ✗ B1 | ~ pie ✗ B1, imagen por menú | ✗ tareas fijas | ~ solo recién creado | ✗ | ✗ texto fijo | ✗ |
| Color | ✓ 5 | — | ✗ | ✗ | — | ✗ | ✗ solo global |
| Cambiar tamaño | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — |
| Girar | ~ pasos de 5° | ~ | ~ | ~ | ~ | ~ | — |
| Chinche / cinta | ✓ | ✓ | ✓ | — | — | — | — |
| Unir con hilo | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | — |
| Duplicar / eliminar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ suelto |
| Copiar / pegar / bloquear | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Faltantes por herramienta

**Nota**
- Editar una nota existente no funciona (B1). Tampoco se puede seleccionar y empezar a escribir, ni usar Enter para entrar a editar.
- Sin tamaño ni tamaño de letra; ancho fijo de 180px.
- Pegar texto (Ctrl+V) no crea una nota. Hoy solo se pegan imágenes.

**Foto / Imagen**
- La foto vacía dice "Arrastra una imagen aquí", pero soltar una imagen sobre ella **crea otra foto nueva** en vez de rellenarla (`drop` siempre llama a `addImages`).
- Sin recorte ni ajuste del encuadre; la imagen se recorta sola con `object-fit: cover`.
- Un solo estilo (polaroid). Faltan "foto sin marco" o "recorte", útiles para capturas.
- No se puede soltar una imagen desde el navegador (URL), solo archivos.

**Lista**
- **No se pueden añadir, editar, reordenar ni borrar tareas.** Solo se edita el título (y eso también falla por B1).
- Se crea en el centro de la vista, sin pedir clic, a diferencia de Nota, Imagen y Texto.
- Sin progreso visible (por ejemplo "2/4").

**Texto**
- El texto que ya existe ("Chinchero v1") **no se puede editar**: le falta el `.note-text`.
- Sin tamaño ni color; la barra contextual solo ofrece girar, traer al frente y eliminar.

**Stickers y sellos**
- Se colocan en el centro de la vista; no se pueden arrastrar desde la paleta al lugar deseado.
- Sin tamaño. El texto del sello no se puede editar (no hay sello propio, por ejemplo "PARA EL LUNES").
- Sin stickers propios importados (U13).

**Hilo**
- **Gesto natural ausente:** arrastrar desde una chinche hasta otra. Hoy hay que activar la herramienta y hacer dos clics.
- Se pueden crear **hilos duplicados** entre el mismo par (no se comprueba si ya existe).
- No se puede seleccionar, borrar uno suelto, ponerle color o etiqueta, ni ajustar cuánto cuelga (U4).
- Solo une elementos con chinche: texto, stickers y sellos quedan fuera. Pasar de chinche a cinta **borra los hilos sin avisar**.

**Chinche**
- Siempre arriba al centro. En la vida real la pones donde quieras: falta poder moverla, y poner más de una.
- El color de chinche de los elementos nuevos es aleatorio; falta "usar el último color elegido".

**Comunes a todos**
- Girar libremente con un asa; hoy el botón avanza en pasos de 5° y salta de +15° a −15°.
- Mover con flechas (Shift = 10px) y Alt+arrastrar para duplicar.
- Al crear, se ignora el ajuste "Inclinación natural" de Ajustes (`randRot` siempre se aplica).
- Las herramientas de crear vuelven a Seleccionar tras un uso; falta poder fijarlas (doble clic en la herramienta) para crear varias seguidas.

### Elementos que faltan

- **Zona / marco**: un rectángulo con título que agrupa elementos y los mueve juntos (como las "Category" de la referencia 4). Es lo que más falta para organizar un tablero.
- **Ficha**: tarjeta con título y cuerpo, más formal que la nota adhesiva.
- **Enlace**: URL con título e imagen de vista previa.
- **Archivo**: PDF u otro adjunto, que se abre con doble clic.
- **Dibujo a mano alzada / rotulador**: para marcar, encerrar en círculos o hacer flechas sobre el corcho.

## 4. Fuera de alcance

- **Móvil**: el editor a 390px funciona pero no es objetivo (la app es para Windows). Se propone definir un tamaño mínimo de ventana en vez de diseñar para móvil.

## 5. Lo que funciona bien

- Estética de corcho: chinches, cinta, polaroid y sombras convincentes en ambos temas.
- Crear hilos tiene buena respuesta: vista previa punteada y aviso de cómo usarlo.
- Hojas con estado vacío claro y pistas.
- Menú contextual completo y con atajos visibles.
- Estados vacíos de grupos y favoritos con llamada a la acción.
- Las preferencias de Ajustes se reflejan en las demás vistas.
