# playground-0001

A 1v1 half-court basketball game built with vanilla HTML Canvas and JavaScript.

## Play

Open `index.html` in your browser, or run a local server:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Controls

| Key | Action |
| --- | --- |
| Arrow keys / WASD | Move |
| Hold Space | Charge shot (release to shoot) |
| Shift | Sprint |
| Enter | Start game / Play again |

## How it works

- **1v1 half court** -- you (blue) vs CPU (red)
- **First to 21 wins**
- Shots inside the arc are worth **2**, outside are worth **3**
- Release the shot when the power bar is in the **green zone** for best accuracy
- Get close to the ball carrier to attempt a **steal**
- After a miss, race the CPU for the **rebound**

## Tech

- Pure HTML / CSS / Canvas -- no frameworks or dependencies
- Single `app.js` game engine (~500 lines)
- 60 fps game loop with delta-time physics
- Simple AI with offensive/defensive behaviors
