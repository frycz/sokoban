# Architecture

The game logic is a pure state transition function; everything else is a thin shell around it. Two front ends sit on top — the game and the level editor — and they share `core/` and the palette, nothing else.

```
index.html     the game
editor.html    the level editor

src/core/       types.ts, level.ts, step.ts, rules.ts   pure, no DOM, no I/O
src/host/       index.ts, history.ts, level-data.ts     history stack, keybindings, dispatch
src/render/     canvas.ts, colors.ts, tile-roles.ts     (state) => draw
src/editor/     document.ts, xsb.ts, validate.ts,       level mode, same pure/shell/draw split
                session.ts, layout.ts, canvas.ts,       plus autosave:
                level-mode.ts, dom.ts, index.ts,        stored-state.ts, storage.ts
src/editor/skin/ sheet.ts, skin.ts, roles.ts,           skin mode
                 palette.ts, preview.ts, atlas.ts
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
      ↑ ↑        ↑           ↑
layout.ts │  stored-state.ts │            pure
      ↑   │       ↑          │
      │  session.ts          │            mutable, no DOM
      │        │             │
    canvas.ts  │  storage.ts │            the only localStorage, a leaf
        └──────┴─────┴───────┴→ index.ts  the only DOM
```

| File              | Role                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `document.ts`     | `EditorDocument`, `Cell`, `Brush`, and the pure edits: `createEmptyDocument`, `paintDocument`, `resizeDocument` |
| `xsb.ts`          | `parseXsbToDocument` / `formatDocumentAsXsb` — the only text I/O                                                |
| `validate.ts`     | `validateDocument(document)` → problems, counts, `isPlayable`                                                   |
| `stored-state.ts` | encode / decode of what autosave keeps, for both modes. Pure                                                    |
| `session.ts`      | the undo stack, the editor's one mutable value. No DOM                                                          |
| `layout.ts`       | tile size, origin, and pixel → cell. Pure                                                                       |
| `canvas.ts`       | `(document, hoverPosition) => draw`. No logic                                                                   |
| `storage.ts`      | the two `localStorage` keys, every call guarded. Imports nothing                                                |
| `index.ts`        | palette, pointer, size inputs, XSB panel. The only file that touches the DOM                                    |

`stored-state.ts` also reads `skin/`, which is the one place the level half of the editor and the skin half meet outside a mode module: autosave covers both, so the codec has to know both shapes.

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

### Every change is autosaved

The editor writes to `localStorage` on every edit and opens where it was left. Two keys, `sokoban.editor.level` and `sokoban.editor.skin`, each written only by the mode that owns that state, so the two modes never coordinate a read-modify-write of one shared record.

Autosave hangs off each mode's `update()` — the call every edit already ends with — rather than being remembered at each of the dozen places that change something. Each mode holds the text it last stored and compares before writing, which keeps a redraw that changed nothing (a hover, a resize, a mode switch) from writing at all and makes the common case one string compare. No debounce: a level is a few kilobytes of XSB, cheap enough to store per painted cell.

The undo stack does not persist. A reload is a new session, and the document is the work.

#### The level is stored as XSB, with `-` for floor

Storing it in the format the editor already reads and writes means there is no second level codec to keep in step. The substitution is the catch: `parseXsbToDocument` trims blank lines off the top and bottom, so a document whose first row is all floor would come back a row shorter. `-` is the XSB alphabet's own explicit floor, so no row is ever blank and the round trip is exact. `stored-state.test.ts` asserts it on exactly that document.

#### A skin is stored with its sheet

A binding is a tile index, which means nothing without the exact image it was cut from, so the sheet travels with the draft as a data url. That is also the string the sidebar thumbnails use, which is why there is no object url left to revoke. Restoring keeps the bindings — unlike loading a sheet, which clears them, because that is new art under the same indices.

A large sheet can exceed the quota. The fallback is to store the draft without the sheet and without the bindings and say so in the status line: the settings survive, the art has to be loaded again. `decodeStoredSkin` drops the bindings whenever the sheet is absent in any case, so a record written before a quota failure — or hand-edited in devtools — cannot come back pointing at nothing.

Nothing is migrated. A record without the current `version` is ignored and the editor opens blank, which for an internal tool's autosave beats guessing at what an older shape meant.

#### Clear storage resets the editor

Clearing the keys without resetting the panels would be a lie, because the next edit autosaves and the state is back. So the button does both, behind a confirm, and `index.ts` owns it: clearing storage is not a level or a skin concern, which is why `EditorMode` has a `reset` for each mode to discard its own half. Each reset moves its "last stored" text along with it rather than writing, so storage stays empty until the next real edit. The level reset goes through `session.replace`, so it lands on the undo stack and Undo brings the level back.

Writes are guarded rather than assumed: storage access throws outright in some embeddings, and a Safari private window accepts reads while refusing writes. A refusal is reported in the status line and the editor keeps working unsaved.

## `editor/skin/` — binds sprites to roles, exports an atlas

Skin mode shares the level document with level mode: the level being drawn is the live preview, which is the only honest way to tell whether a skin reads.

```
render/tile-roles.ts   ROLE_ORDER, TileRole        pure leaf, no imports
        ↑
sheet.ts ← skin.ts ← atlas.ts                      pure (atlas.ts packs on a canvas)
   ↑         ↑          ↑
roles.ts     │          │                          pure
   ↑         │          │
palette.ts  preview.ts  │                          draw
      └──────┴──────────┴→ skin-mode.ts            the only DOM
```

### A skin binds roles, not cells

The game renderer resolves a sprite from state — it never sees a cell's identity — so a skin can say "walls look like this" but not "the wall at (4, 7) looks like this". Clicking the preview therefore binds the role of the cell clicked, via `getTopRoleAtCell`, and every wall changes at once.

Per-cell decoration is a different feature: it is level data, not skin data, and it would need the XSB format to carry a decoration layer. Not deferred so much as separate.

Because a level need not contain every role — there is nothing to click if it has no goals — the role list in the sidebar is a second drop target for the same action. The palette selection is the brush; the preview and the role list are both places to apply it.

### Fourteen roles: six required, eight optional

`ROLE_ORDER` in `render/tile-roles.ts` is the single source of truth: `TileRole` is derived from it, so a role cannot exist without a column in the atlas, and `EMPTY_BINDINGS` is built from it so a new role cannot be missing from a draft.

The six in `REQUIRED_ROLES` gate an export. The eight in `WALL_VARIANT_ROLES` — four sides, four corners — are optional refinements, and `getBaseRole` sends any unbound one to `wall`. That is what keeps a six-tile skin rendering every wall, and what lets the editor offer both a quick flat skin and a fully pieced one without a second format.

`boxOnGoal` earns its own tile because it is the only "this one is done" signal on the board. `playerOnGoal` does not exist: goal is drawn on the ground layer and the player composites over it.

### Wall pieces are named for the frame, not the exposed face

A piece is named for where it sits in the wall **around** the floor. Floor to the south means the cell caps the wall above that floor, so it takes `wallTop` — not `wallBottom`. Getting this backwards renders every room inside out, with each wall's cap facing away from the player.

### Wall classification needs all eight neighbours

Four will not do, and the reason is the shape the pieces exist for:

```
#####     The corners of a one-cell-thick border have no
#   #     orthogonally adjacent floor — only diagonal. Four
#   #     neighbours cannot tell a corner from a buried block.
#####
```

So `getWallRole` takes a `WallNeighbourhood` of eight booleans and resolves in that order of specificity: one open side is an edge, no open side but an open diagonal is a corner, nothing open at all is the fill.

Two or more open sides is a thin wall or an inner corner, and nine pieces have no tile for either; those degrade to the first edge in priority order, which prefers the top. `tile-roles.test.ts` asserts a wall role comes back for all 256 neighbourhoods, so no level can produce an undrawable cell. Resolving the degraded cases properly needs the 47-piece blob set, which is a much larger art burden for a case Sokoban walls rarely show.

`wall` is in practice the fallback rather than a tile that gets drawn: a cell with nothing open anywhere is culled before classification, exactly as in the game. It stays required because every unbound piece falls back to it.

The classifier lives in `render/` rather than the editor so the preview and the game cannot disagree about which piece a wall gets; `editor/skin/roles.ts` only reads the neighbourhood off a document, treating off-grid as wall so a document's outer edge is not an exposed face.

### Layer order, and what it asks of the art

```
floor   → every cell of the board, walls included
wall    → over floor
goal    → over floor
object  → box / boxOnGoal / player, over both
```

Floor is one layer under the whole board rather than a tile that the others replace, so every other tile can be a transparent overlay _or_ an opaque tile of its own without the author having to redraw floor into it. What falls out is the one authoring rule: floor opaque, everything else free to use transparency.

That includes `wall`: a wall piece that leaves its edges transparent — a rounded cap, a bevel, a soft shadow onto the floor — composites over the floor it sits on instead of leaving a hole. The nine wall pieces are the reason this matters, since every one of them is an edge or corner whose outline is the point.

A wall with no floor around it is not drawn at all, exactly as in the game — not even floor — so a skin never supplies art for "outside the level" and the board keeps its silhouette against the page.

### An unbound role draws as flat colour

`preview.ts` falls back to the procedural palette for anything unbound, so the preview is always readable and what is still missing shows as a flat block rather than a hole.

### One vocabulary for every sheet, including our own output

`SheetSettings` is `tileWidth`, `tileHeight`, `margin`, `spacing` — enough to slice essentially any tileset. The exported atlas is described with the same four numbers, so the game's loader will cut our output with the identical arithmetic instead of a second special-cased path.

Re-slicing drops every binding. A tile index only means something against one grid, so keeping indices that now point at different art would be silently wrong; `clearBindings` is the honest answer.

### The manifest's role list is data, not a convention

```json
{
  "name": "mossy-stone",
  "tileWidth": 32,
  "tileHeight": 32,
  "margin": 1,
  "spacing": 2,
  "pixelated": true,
  "roles": ["floor", "goal", "wall", "box", "boxOnGoal", "player"]
}
```

One row, `roles[n]` in column `n`, listing exactly the roles the image contains — an unbound role takes no column. Naming them in the file is what lets a six-tile skin and a fourteen-tile skin share one format with no version field, and what lets the set grow — more wall pieces, ice, conveyors — by appending to `ROLE_ORDER` and widening the image, with no breakage for skins already exported, because every skin describes itself.

### Exported tiles are extruded by a pixel

The game scales tiles to fit the canvas and so is almost never drawing at native size. Without extrusion, neighbouring tiles bleed in along the seams at some window sizes. `atlas.ts` duplicates each tile's edge rows, columns and corner pixels outward, which is exactly what `margin: 1` and `spacing: 2` in the manifest describe — one pixel before the first tile, two between each pair, one from each side. No column is ever shared between two tiles.

Packing also ships only what the skin uses, so a skin cut from a 500-tile sheet exports as six tiles.

## Boundaries that matter

- Rules live only in `core/`. `step` is the single place state changes.
- Input mapping lives only in `host/`. `core/` never sees a keycode — it takes a `PlayerMoveDirection`.
- Undo lives only in `host/`, outside engine state.
- `core/` imports nothing from `host/`, `render/` or `editor/`, so it runs unchanged in Node tests, a terminal front end, or a solver.
- `editor/` imports nothing from `host/`, and `host/` imports nothing from `editor/`. The two front ends meet only in `core/` and in the leaves of `render/`.
- `render/colors.ts` and `render/tile-roles.ts` are leaves that import nothing. They exist so the level you draw looks like the level you play, and so the editor and the game agree on what a role is, without the editor depending on the game's renderer.
- The DOM lives only in `host/index.ts`, `editor/index.ts`, `editor/level-mode.ts` and `editor/skin-mode.ts`. Everything under `editor/skin/` is pure or draws into a canvas it was handed.
- `localStorage` lives only in `editor/storage.ts`, which holds the keys and swallows the browser's failure modes. What goes in them is `editor/stored-state.ts`, which is pure and tested; the game stores nothing.
- `editor/index.ts` is a mode switch and nothing else: it owns which panel is visible and routes keys and resizes to it.

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
