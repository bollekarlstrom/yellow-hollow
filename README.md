# Ember Hollow

A small autumn-themed silhouette puzzle-platformer that runs in the browser.
A hooded wanderer carries a lantern through a dusky forest of falling leaves,
fog, wind and crows.

## Play

Open `index.html` in a browser. Nothing needs to be installed.

| Key | Action |
|---|---|
| ← → / A D | Walk |
| Space / ↑ / W | Jump (hold to jump higher) |
| R | Restart from the last checkpoint |
| M | Mute |

## How it's built

All the code is in `game.js` and uses only the HTML5 Canvas, with no libraries.
The trees, sky, particles and sounds are all generated in code, so the game has no image or audio files.

- **Level layout:** the `solids`, `leafPits`, `gate`, `brambles` and `checkpoints` arrays near the top of `game.js`
- **Physics:** `updatePlayer()`
- **Visuals:** the `draw*()` functions and the `makeLayer()` parallax backgrounds
