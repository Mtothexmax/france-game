Phaser Jump'n'Run — France Game

Quick start

1. Serve the project folder over HTTP (browsers block local file XHR). From the project root run one of:

```powershell
# Python 3
python -m http.server 8000

# or using PowerShell's simple listener
# if you have live-server extension in VS Code, open index.html with it
```

2. Open http://localhost:8000 in your browser.

Assets
- Map: sprites/map1.tmj (Tiled JSON). The map may be exported as infinite; the game uses the map's pixel size to set world bounds.
- Tileset image: sprites/tileset.png
- Character images: sprites/character/walking.png, sprites/character/shooting.png
- Character annotations (rectangles): sprites/character/walking_anotation.json, sprites/character/shooting_annotation.json

Controls
- Move: Arrow keys or A / D
- Jump: Up or W or Space

Notes
- The code auto-generates texture frames from the annotation JSON files by cropping the source images at runtime. If you extend the Tiled map file (export new chunks), the map's pixel dimensions are read at load-time and used for world bounds.
- For development you may want to enable `debug: true` in `js/game.js` under `physics.arcade`.

Files added
- index.html — game entry
- js/game.js — Phaser game
- README.md — this file

If you want me to add enemies, collectibles, or polish animations, tell me which behavior you'd like next.