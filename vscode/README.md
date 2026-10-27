# PuzzleScript (psbs)

Soporte de PuzzleScript para VS Code, parte de **psbs-dev**.

- Resaltado de sintaxis por sección (OBJECTS, LEGEND, RULES, LEVELS…)
- Errores y avisos del **compilador oficial** mientras escribís
- Autocompletado de objetos, leyenda, colores y palabras clave según la sección
- Hover: vista previa del sprite de cada objeto y del **mapa de cada nivel**
- Ir a definición (también desde un carácter del mapa), referencias, renombrar
- Esquema del documento (secciones, objetos, niveles)
- Selector de color sobre los colores de los objetos
- "▶ Jugar nivel N" sobre cada nivel y `Cmd/Ctrl+Enter` para jugar el nivel bajo el cursor: abre el juego al lado con hot reload (requiere `psbs` instalado)

Los archivos `.puzzlescript`/`.pzs` se reconocen solos. Para `.txt`, ejecutá `psbs init` en la carpeta del proyecto.
