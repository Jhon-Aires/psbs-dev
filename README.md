# psbs-dev

Entorno de desarrollo local para **PuzzleScript** y proyectos **[PSBS](https://github.com/jcmiller11/PSBS)**: escribís el juego en VS Code (o el editor que quieras) y el juego se recarga solo, sin perder el nivel en el que estabas.

El comando es `psbs-dev` (no choca con `psbs`, el de PSBS).

Usa el motor y el editor **oficiales** de PuzzleScript (incluidos, funciona offline), así que los errores y el comportamiento son exactamente los de puzzlescript.net.

## Instalación (una vez)

Requisitos: [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install -g ./psbs-dev     # desde la carpeta que contiene psbs-dev
psbs-dev vscode               # instala la extensión de VS Code (opcional)
```

> Si `psbs-dev vscode` no encuentra VS Code, instalá a mano el archivo `vscode/puzzlescript-psbs.vsix`:
> Extensiones → `…` → *Instalar desde VSIX…*

## Uso con PSBS

En la carpeta de tu proyecto PSBS (la que tiene `config.yaml` y `src/`):

```bash
psbs-dev init      # una vez: VS Code abre los .pss como PuzzleScript
code .
psbs-dev dev       # abre el juego en el navegador
```

- Guardás cualquier `.pss` (o `config.yaml`) → corre `psbs build` → el juego se recarga desde `bin/script.txt` **en el mismo nivel**.
- Los errores salen como `src/rules.pss:12` (entre paréntesis, la línea de `bin/script.txt`). Las líneas generadas por la plantilla (loops, variables) se muestran con la línea de `bin/script.txt`.
- Si `psbs build` falla, el juego sigue con la última versión que compiló y el error se ve en la terminal.
- Se usa el motor oficial incluido; si `config.yaml` apunta a un fork, el juego se prueba igual con el oficial.
- Si `psbs` no está en el PATH, se prueba `python3 -m psbs`. También podés definir `PSBS_CMD`.

## Uso con un solo archivo

```bash
psbs-dev new mi-juego  # crea mi-juego/game.txt + configuración de VS Code
cd mi-juego && code .
psbs-dev dev
```

## Comandos

| Comando | Qué hace |
|---|---|
| `psbs-dev dev [archivo]` | Servidor local con hot reload. Abre `/play` (solo el juego); con `--editor` abre el editor oficial + juego |
| `psbs-dev check [archivo]` | Compila y lista errores como `archivo:línea` (exit 1 si hay errores) |
| `psbs-dev build [archivo] [-o salida.html]` | Exporta a un único HTML jugable offline (igual que EXPORT del editor) |
| `psbs-dev new <nombre>` | Proyecto simple (un solo `game.txt`). Para PSBS usá `psbs new` |
| `psbs-dev init` | Configura VS Code en la carpeta (`.pss` en proyectos PSBS, `.txt` si no) |
| `psbs-dev vscode` | Instala/actualiza la extensión de VS Code |

### Cómo funciona el hot reload

- Guardás → el juego se recompila **en el mismo nivel**.
- Si guardás con un error, se muestra en la terminal (y en la consola del editor web); al corregirlo volvés al nivel donde estabas.
- Con `--editor`, `Ctrl/Cmd+S` dentro del editor web guarda en el archivo (en proyectos PSBS está desactivado: el script es generado).
- Se ocultan "Load", "Load Example" y "SHARE" del editor: cargarían otro juego encima de tu archivo (y SHARE necesita puzzlescript.net).

### Extensión de VS Code

- Resaltado de sintaxis por sección, incluidas las etiquetas de plantilla de PSBS `(% %)`, `(( ))`, `(# #)`
- En proyectos PSBS: autocompletado, hover e ir a definición con los nombres de **todo el proyecto**; renombrar cambia todos los `.pss`; los errores aparecen en el `.pss` correspondiente
- Errores del compilador oficial mientras escribís
- Autocompletado de objetos, leyenda, colores y palabras clave según la sección
- Hover: sprite de cada objeto y **vista previa del mapa** de cada nivel
- Ir a definición (también desde un carácter del mapa), buscar referencias y renombrar
- Esquema (secciones, objetos, niveles) y selector de color
- **▶ Jugar nivel N** encima de cada nivel, o `Cmd/Ctrl+Enter` con el cursor en un nivel: abre el juego al lado, dentro de VS Code, en ese nivel

## Desarrollo de psbs-dev

```bash
npm test                 # pruebas (compilador, CLI y extensión con API simulada)
npm run build:vscode     # regenera vscode/puzzlescript-psbs.vsix
```

Para actualizar el motor: reemplazá `engine/` con `src/` de [increpare/PuzzleScript](https://github.com/increpare/PuzzleScript) (sin `Gallery/` ni `tests/`), actualizá `engine/VERSION` y corré `npm test && npm run build:vscode`.

## Licencias

- psbs-dev: MIT.
- PuzzleScript (carpeta `engine/`): MIT, © Stephen Lavelle — ver `engine/LICENSE`. Versión incluida en `engine/VERSION`.
