# Architecture

The game logic is a pure state transition function; everything else is a thin shell around it. Two front ends sit on top — the game and the level editor — and they share `core/` and the palette, nothing else.

```
index.html     the game
editor.html    the level editor

src/core/      types.ts, level.ts, step.ts, rules.ts    pure, no DOM, no I/O
src/host/      index.ts, history.ts, level-data.ts      history stack, keybindings, dispatch
src/render/    canvas.ts, colors.ts                     (state) => draw
src/editor/    document.ts, xsb.ts, validate.ts,        the editor, same pure/shell/draw split
               session.ts, layout.ts, canvas.ts,
               index.ts
```

TypeScript, built with Vite. `npm run verify` checks everything (format, lint,
knip, types, tests).

| Command                | What it does                        |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | the game, on :5173                  |
| `npm run editor`       | the level editor, on :5174          |
| `npm run build`        | ships the game to `dist/`           |
| `npm run build:editor` | builds the editor to `dist-editor/` |

The game is the product and the editor is an internal tool, so they do not share
a build: `npm run build` takes `index.html` as its only entry, and no editor code
reaches the shipped bundle. They still share `core/`, and `npm run verify` covers
both.

## `core/` — pure, no DOM, no I/O

| File       | Exports                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts` | `PlayerMoveDirection`, `Level`, `LevelState`                                                                                                                                                                                       |
| `level.ts` | `parseStringToLevelState(xsb: string)` → the initial `LevelState`                                                                                                                                                                  |
| `step.ts`  | `step(levelState: LevelState, playerMoveDirection: PlayerMoveDirection): LevelState` — returns the same state for illegal moves                                                                                                    |
| `rules.ts` | `isSolved(levelState)`, `getNextPosition(level, position, playerMoveDirection)`, `isPositionValid` (built from `isPositionOnLevel` + `isPositionWall`), `isPositionBox`, `isPositionPlayer`, `isPositionFree`, `updateBoxPosition` |

### State shape

```ts
type PlayerMoveDirection = 'up' | 'down' | 'left' | 'right'
type Level = {
  width: number
  height: number
  wallMap: boolean[]
  goalPositions: ReadonlySet<number>
}
type LevelState = {
  level: Level
  playerCurrentPosition: number
  boxPositions: ReadonlySet<number>
}
```

### There is no `Action` type

The engine takes a bare `PlayerMoveDirection`, not a tagged `{ type: 'move'; playerMoveDirection: PlayerMoveDirection }`. A discriminated union with one member costs a wrapper object at every call site and carries no information, and Sokoban's engine genuinely has one action — undo, reset, and level-select are all history or host concerns.

It also means `PlayerMoveDirection[]` is the engine's replay format, which lines up with the standard LURD solution notation: replaying is `playerMoveDirections.reduce(step, initial)`.

If a second engine-level action ever appears, the union comes back and the call sites change. That is a deliberate bet that one never will.

The host does have three commands, so the tag lives there instead:

```ts
type Command =
  | { type: 'move'; playerMoveDirection: PlayerMoveDirection }
  | { type: 'undo' }
  | { type: 'reset' }
```

Static data (`Level`) is separated from dynamic data (`LevelState`). The level never changes, so snapshots for undo only copy the player position and the box set.

### Positions are flat indices

Positions are row-major indices into the flattened grid, not `{x, y}` objects.

```ts
const index = y * width + x
const x = index % width
const y = Math.floor(index / width)
```

Why: JavaScript `Set` and `Map` compare objects by reference, so `set.has({x, y})` is always false. Numbers are compared by value, so `Set<number>` membership works and is O(1). It also makes `wallMap` a direct array lookup, and it makes states cheap to hash and compare, which matters if deadlock detection or a solver is added later.

The gotcha: moving `left` from `x === 0` wraps to the end of the previous row instead of going out of bounds. Guarded in one place — `getNextPosition()` in `rules.ts` converts to x/y, adds the delta, bounds-checks, and converts back, returning -1 when the step leaves the grid. Nothing else in the codebase does index arithmetic on positions.

### Walls come from a flood fill, not a border

Real level text is ragged: short lines, leading spaces that are outside the puzzle, and wall segments with empty space behind them. Rather than requiring or synthesising an outer border, `parseStringToLevelState()` flood-fills from the player across non-wall characters and marks everything it cannot reach as a wall.

That makes the playfield self-enclosing by construction, collapses the "outside the level" and "wall" cases into one flag, and catches malformed levels — a box or goal sealed off from the player is a parse error rather than an unwinnable game.

### Level format

Levels are parsed from standard XSB text, so existing level sets work without conversion.

| Character | Meaning        |
| --------- | -------------- |
| `#`       | wall           |
| `$`       | box            |
| `.`       | goal           |
| `@`       | player         |
| `*`       | box on goal    |
| `+`       | player on goal |
| space     | floor          |

## `host/` — the only mutable thing in the system

Split in two, along the DOM line:

- `history.ts` — `createHistory(initial)` owns a `LevelState[]` stack, the only mutable value in the program. Calls `step`, pushes the result, undoes by popping and resets by truncating to the first entry. `run(command)` returns whether anything changed. No DOM, so it is unit-testable.
- `index.ts` — element lookup, keybindings, and the status line. Re-renders when `run` reports a change.

No game rules live in either.

Undo is deliberately outside engine state. Because `step` is pure, keeping a stack of previous states gives undo, redo, and replay for free, and the engine stays simple.

Illegal moves are detected by identity: `step` returns the same object when nothing changed, so `next === current()` means the move was rejected and no history entry is recorded. That identity contract is load-bearing, and `step.test.ts` asserts it with `toBe` rather than `toEqual`.

Keys: arrows or WASD to move, Z or U to undo, R to reset.

## `render/` — dumb

`createRenderer(canvas)` returns a `render(levelState): void` that redraws the whole board. Reads `level.wallMap` and `level.goalPositions` for the board, and `playerCurrentPosition` and `boxPositions` for the movable pieces. No event listeners, no game logic, no knowledge of history.

Full redraw every time is deliberate: it keeps the renderer a pure function of state with nothing to invalidate, and a Sokoban board is small enough that the cost is irrelevant.

## `editor/` — draws levels, speaks XSB

Same three-layer split as the game, and a strict DAG. Each arrow points from a module to the modules it may import; nothing imports downward.

```
core/rules.ts   core/level.ts
      ↑               ↑
document.ts ← xsb.ts ← validate.ts        pure
      ↑ ↑                    ↑
layout.ts │                  │            pure
      ↑   │                  │
      │  session.ts ─────────┤            mutable, no DOM
      │        │             │
    canvas.ts  │             │            (document) => draw
        └──────┴─────────────┴→ index.ts  the only DOM
```

| File          | Role                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `document.ts` | `EditorDocument`, `Cell`, `Brush`, and the pure edits: `createEmptyDocument`, `paintDocument`, `resizeDocument` |
| `xsb.ts`      | `parseXsbToDocument` / `formatDocumentAsXsb` — the only text I/O                                                |
| `validate.ts` | `validateDocument(document)` → problems, counts, `isPlayable`                                                   |
| `session.ts`  | the undo stack, the editor's one mutable value. No DOM                                                          |
| `layout.ts`   | tile size, origin, and pixel → cell. Pure                                                                       |
| `canvas.ts`   | `(document, hoverPosition) => draw`. No logic                                                                   |
| `index.ts`    | palette, pointer, size inputs, XSB panel. The only file that touches the DOM                                    |

### The editor does not use `LevelState`

`LevelState` is the _validated, playable_ shape: it requires a player, at least one box, boxes matching goals, and walls resolved by flood fill. That describes a finished level, and the editor's whole job is the unfinished ones. So `EditorDocument` is its own type — a flat `Cell[]` that is allowed to be nonsense — and `parseXsbToDocument` accepts anything spelled with the XSB alphabet without judging it.

A `Cell` is `{ isWall, isGoal, content }` rather than one of the seven XSB characters, because the brushes combine: painting a goal under a box has to produce `*`, which is a field update on a structured cell and a lookup table on a flat enum.

### Validation is a report, not a parse error

`validateDocument` returns a list instead of throwing, because every level is invalid while it is being drawn — the box/goal counts are unequal for as long as it takes to place the matching goal. Enforcing equality during editing would make the editor unusable, so it is reported and the Export is simply marked not playable.

The severities are a real line, not a mood: `error` means `parseStringToLevelState` will refuse the text, so no errors is a promise that the level loads in the game. `warning` means it loads but probably isn't intended — currently only floor touching the outer edge, which plays fine but renders with no border. `validate.test.ts` asserts the promise in both directions.

`core/level.ts` exports `getPositionsReachableFrom` for this: the "box walled off from the player" check is the parser's own flood fill, so the two cannot disagree about what counts as inside the level.

### An empty level is solid wall

`createEmptyDocument` fills with wall, not floor, so drawing carves a room out of rock. That makes `floor` the additive brush, keeps every new level sealed by construction, and means the border is never something you have to remember to trace.

### Single player is an invariant, not a rule

`paintDocument` clears any existing player when a player is painted, so the document can never hold two by editing. Validation still checks the count, because loaded XSB can.

### Undo coalesces per stroke

`session.beginStroke()` opens an undo entry and every `paint` until the next one folds into it, so dragging across twenty cells undoes once. `paintDocument` returns the same object when the cell already looked like that, so a stroke that changed nothing records nothing — the same identity contract `step` has with the host.

## Boundaries that matter

- Rules live only in `core/`. `step` is the single place state changes.
- Input mapping lives only in `host/`. `core/` never sees a keycode — it takes a `PlayerMoveDirection`.
- Undo lives only in `host/`, outside engine state.
- `core/` imports nothing from `host/`, `render/` or `editor/`, so it runs unchanged in Node tests, a terminal front end, or a solver.
- `editor/` imports nothing from `host/`, and `host/` imports nothing from `editor/`. The two front ends meet only in `core/` and in `render/colors.ts`.
- `render/colors.ts` is a leaf. It exists so the level you draw looks like the level you play without the editor depending on the game's renderer.
- `index.ts` is the only file in each front end that touches the DOM.

## Tests

Vitest, no environment and no mocks — every test is a plain function call. Tests sit next to the code as `*.test.ts`. `npm test` runs them; `npm run test:watch` watches.

Vitest is pinned to 2.x because 3+ requires Vite 6, and this project is on Vite 5. The two move together when Vite does.

`core/test-helpers.ts` keeps the fixtures readable by making XSB the test language in both directions:

| Helper                      | Purpose                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `xsb(...lines)`             | joins rows into level text — leading spaces are significant, so rows are listed rather than indented inline |
| `toXsb(levelState)`         | renders a state back to XSB, so expectations are boards instead of position sets                            |
| `play(levelState, lurd)`    | replays standard LURD notation                                                                              |
| `openLevelState(w, h, ...)` | a wall-free grid, for states the parser cannot produce                                                      |

`toXsb` makes a push assertion one string instead of hand-built `Set`s and index arithmetic, and round-tripping cross-checks the parser against itself. `openLevelState` exists because the flood fill seals every parsed level in walls, so the row-wrap guard in `getNextPosition` can only be exercised on a hand-built level with a player on column 0.

`host/level-data.test.ts` replays a 97-push LURD solution of the shipped level and asserts `isSolved`, plus that the state one move short is _not_ solved. One test, but it covers the parser, both move and push paths and all four directions against a real board.

The suite is checked against deliberate regressions, not just written: dropping the bounds check in `getNextPosition`, ignoring what is behind a pushed box, replacing the flood fill with the raw open map, making `isSolved` vacuous, and letting undo run past the start each fail at least one test.

The editor's four pure modules are tested the same way, with XSB as the language in both directions — `parseXsbToDocument` in, `formatDocumentAsXsb` out, so a brush test is two boards. `layout.ts` and `canvas.ts` are untested: one is three lines of arithmetic the pointer handler and the renderer share, the other is drawing.

## Naming

Identifiers are spelled out: `playerMoveDirection` not `dir`, `destination` not `dest`, `context` not `ctx`, `character` not `char`, `position` not `i`.

The only short names left are `x` and `y` for grid coordinates, where the single letters are the convention rather than a contraction.

## Deferred decisions

- `step` returns only the new state, not `{ state, events }`. Animation and sound will need either a diff of consecutive states or an event channel; that choice is postponed until one of them is actually built.
- The level is a hardcoded string in `host/level-data.ts`, to avoid an async loading path before there is anything to look at. When real level sets arrive they go in `levels/*.sok` as plain text, the host fetches them, and `core/level.ts` gains a pure `parseCollection(text)` to split a multi-level file and strip its `Title:` / `Author:` metadata. `parseStringToLevelState()` itself does not change.
- Redo is not wired up. The history stack already supports it; it needs a forward stack and a key.
