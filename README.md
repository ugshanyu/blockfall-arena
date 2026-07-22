# Tetris

A mobile-first falling-block game for Usion. It starts immediately in solo mode, supports host-authoritative arena matches for up to eight players, and submits earned scores to Usion records.

## Controls

- Touch/pointer: drag horizontally, tap to rotate, swipe down to hard drop.
- Buttons: hold, rotate, hard drop.
- Keyboard: arrows move/drop, `Z`/`X` rotate, `Space` hard drops, `C` holds, `P` pauses.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

The standalone browser build plays locally. Inside Usion it waits for `Usion.init`, supports solo-to-room promotion through the host Share button, and uses the platform relay for multiplayer.
