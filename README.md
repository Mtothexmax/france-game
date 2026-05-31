Phaser Jump'n'Run — France Game

https://mtothexmax.github.io/france-game/

Purpose

This repository contains a minimal Phaser 3 platformer that loads a Tiled map (`sprites/map1.tmj`) and a tileset image (`sprites/tileset.png`). The playable character is composed from the images and rectangle annotations inside `sprites/character/`.

Important behavior requirements

- The player collides with tiles on the Tiled layer named `Walk on` (solid ground).
- The player can both walk on and jump through tiles on the Tiled layer named `Walk on and jump through` (one-way platforms).
- Do NOT modify the `.tmj` file programmatically — Tiled requires the original format to remain valid. A helper script is provided to create character annotation files without touching the map.
- No on-screen control hints are displayed in-game.

Annotation helper

Use `tools/generate_annotations.py` to produce simple rectangular annotations for a spritesheet. It slices an image into a regular grid and writes a JSON array of objects with `name,x,y,width,height`.

Example:

```powershell
python tools/generate_annotations.py --input sprites/character/walking.png --frame-width 120 --frame-height 280 --out sprites/character/walking_auto_annotation.json
```

Requirements

- Python with Pillow (`pip install Pillow`) to run the annotation helper.

Files

- `index.html` — game entry
- `js/game.js` — Phaser scene and game logic
- `tools/generate_annotations.py` — helper to create annotation JSON files (does not modify map files)

If you want enemies, collectibles, or improved animation blending, specify what behavior to add next.