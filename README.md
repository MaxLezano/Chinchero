<p align="center"><img src="web/assets/icon-256.png" width="96" alt=""></p>

# Chinchero

**Tu tablero de corcho digital para Windows.** Pincha notas, fichas, listas, fotos, enlaces, archivos y stickers; únelos con hilos como en las películas de detectives y organízalos en tableros, hojas, zonas y grupos. Funciona sin conexión y todo queda en tu equipo.

- 🌐 Web y descargas: https://tuchinchero.com/
- ⬇️ Instalador: [Releases](https://github.com/MaxLezano/Chinchero/releases) (`Chinchero-Setup-X.Y.Z.exe` para Intel y AMD, `-arm64.exe` para ARM)

## Estructura

| Carpeta | Qué hay |
|---|---|
| `app/` | La aplicación de escritorio (Electron). `src/main` proceso principal, `src/preload` puente seguro, `src/renderer` pantallas. |
| `web/` | Web estática del producto (GitHub Pages): animaciones, capturas y descargas leídas de GitHub Releases. |
| `.github/workflows/` | `release.yml` compila y publica los instaladores al subir una etiqueta; `pages.yml` publica la web. |

## Desarrollo

```bash
cd app
npm install
npm start          # abre la app
npm test           # pruebas de interfaz, de la app real y de funcionamiento sin internet
npm run dist       # genera los instaladores x64 y ARM64 en app/dist/
```

> Si `npm start` abre algo raro o falla con `Cannot read properties of undefined`, la terminal tiene definida `ELECTRON_RUN_AS_NODE` (pasa dentro de VS Code). Ejecuta `set ELECTRON_RUN_AS_NODE=` en cmd o `Remove-Item Env:ELECTRON_RUN_AS_NODE` en PowerShell.

Para probar sin tocar tus datos reales: `CHINCHERO_USER_DATA` y `CHINCHERO_DATA_DIR` apuntan el perfil y la carpeta de datos a otra ubicación.

## Publicar una versión

1. Sube la versión en `app/package.json` (por ejemplo `0.2.0`).
2. Commit y etiqueta: `git tag v0.2.0 && git push origin main --tags`.
3. GitHub Actions compila el instalador y crea la release. La app instalada se actualiza sola y la web la muestra automáticamente.

## Datos

Los tableros se guardan en `Documentos\Chinchero` (configurable en Ajustes):
`library.json` (grupos y tableros), `boards/<id>.json` (contenido) y `media/` (imágenes y archivos copiados).
Desinstalar la app no borra esa carpeta.

## Licencia

MIT. Las fuentes Inter y Caveat se incluyen bajo la SIL Open Font License 1.1.
