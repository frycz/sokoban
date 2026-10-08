# Architecture

The game logic is a pure state transition function; everything else is a thin shell around it. Two front ends sit on top — the game and the level editor — and they meet in three places and no others: `core/`, `render/`, and the `levels/` directory the editor writes and the game plays.

```
index.html     the game
editor.html    the level editor
levels/        one directory per level — what the editor exports and the game plays

src/core/       types.ts, level.ts, step.ts, rules.ts   pure, no DOM, no I/O
src/host/       index.ts, history.ts, levels.ts,        picker, history stack,
                level-data.ts                           keybindings, dispatch
src/render/     canvas.ts, colors.ts, tile-roles.ts,    (state) => draw
                sheet.ts, skin.ts
src/editor/     document.ts, xsb.ts, validate.ts,       level mode, same pure/shell/draw split
                session.ts, layout.ts, canvas.ts,       plus autosave:
                level-mode.ts, dom.ts, index.ts,        stored-state.ts, autosave.ts,
                publish.ts                              storage.ts — and the export to levels/
src/editor/skin/ skin.ts, roles.ts, atlas.ts,           skin mode
                 custom-tiles.ts, palette.ts,
                 palette-layout.ts, preview.ts
tools/          level-export-plugin.ts                  the dev-server endpoint publish.ts posts to
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
reaches the shipped bundle. They still share `core/`, the leaves of `render/`, and
`levels/` — which the editor writes and the game reads — and `npm run verify`
covers both.

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

Split along the DOM line:

- `history.ts` — `createHistory(initial)` owns a `LevelState[]` stack, the only mutable value in the program. Calls `step`, pushes the result, undoes by popping and resets by truncating to the first entry. `run(command)` returns whether anything changed. No DOM, so it is unit-testable.
- `levels.ts` — finds everything in `levels/`, parses it, loads each atlas, and hands back a list of playable levels plus the problems it hit. Async, and the only I/O the game does.
- `index.ts` — two screens, element lookup, keybindings, and the status line. Re-renders when `run` reports a change.

No game rules live in any of them.

### The game is a picker and a board

`index.ts` holds one `activeGame` — the level, its history and its renderer — and
it is null while the picker is up. That null is also the keybinding guard: the
arrow keys belong to a board, and until a level is picked there is no board for
them to move anything on. Escape and the Levels button put it back to null.

The renderer is built per level rather than once for the canvas, because the
skin belongs to the level: `createRenderer(canvas, level.skin, level.customTiles)`
draws that bundle's tiles, and `createRenderer(canvas, null)` draws the
procedural palette for a level that shipped without any.

A card's miniature is that same renderer pointed at a small canvas, so a
miniature is not an approximation of the level — it is the game's own view of it,
tiles and all, at card size. The cost is that a canvas has to be measured while
it is on screen, which is why the miniatures repaint on a resize and on coming
back from a level rather than once at startup.

Undo is deliberately outside engine state. Because `step` is pure, keeping a stack of previous states gives undo, redo, and replay for free, and the engine stays simple.

Illegal moves are detected by identity: `step` returns the same object when nothing changed, so `next === current()` means the move was rejected and no history entry is recorded. That identity contract is load-bearing, and `step.test.ts` asserts it with `toBe` rather than `toEqual`.

Keys: arrows or WASD to move, Z or U to undo, R to reset, Escape for the level list.

## `render/` — dumb

`createRenderer(canvas, skin, customTiles)` returns a `render(levelState): void` that redraws the whole board. Reads `level.wallMap` and `level.goalPositions` for the board, and `playerCurrentPosition` and `boxPositions` for the movable pieces. The custom tiles are the one thing it draws that is not a function of state — they are the level's own art, fixed for its lifetime, which is why they are a constructor argument like the skin. No event listeners, no game logic, no knowledge of history.

Full redraw every time is deliberate: it keeps the renderer a pure function of state with nothing to invalidate, and a Sokoban board is small enough that the cost is irrelevant.

| File            | Role                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas.ts`     | the two painters — tiles when there is a skin, flat colour when there is not                                                                |
| `colors.ts`     | the palette, a leaf                                                                                                                         |
| `tile-roles.ts` | `ROLE_ORDER`, `TileRole`, and the wall classifier, a leaf                                                                                   |
| `sheet.ts`      | how to cut a grid of tiles out of an image. Pure                                                                                            |
| `skin.ts`       | a manifest parsed, bound to its atlas, and resolved to a rect per role — or per column, for the custom tiles. Also reads `tiles.json`. Pure |

### The skin lives in `render/`, not in the editor

A skin is drawn by both front ends — the editor previews one, the game plays
one — so the pieces they share sit in `render/` with `colors.ts` and
`tile-roles.ts` rather than in `editor/skin/`, which `host/` is not allowed to
import.

That is what makes the manifest's promise real: `sheet.ts` is the arithmetic the
editor slices a picked tileset with _and_ the arithmetic the game cuts the
exported atlas with, so an exported skin cannot be sliced differently from the
sheet it was authored against. `editor/skin/palette-layout.ts` keeps what is
genuinely the editor's — where the palette draws the sheet, and the pointer's
way back.

`skin.ts` is the game's half of the format: `parseSkinManifest` reads a file
nobody has validated, `createSkin` binds it to the decoded atlas, and
`getSkinTileRect` answers "which pixels is this role?" — applying the same
`getBaseRole` fallback the preview uses, so an unbound wall piece degrades to the
wall fill identically in both. An unrecognised role name is skipped but still
takes its column, so a manifest from a later editor keeps working for the roles
this build knows.

Two painters rather than one in `canvas.ts`: the procedural board draws rounded
boxes and a circle for the player, which a tile cannot, and the tiled board
layers floor-then-wall-or-goal-then-object exactly as the skin format asks. They
share the canvas sizing and the grid, so a board looks the same shape either way.

## `levels/` — the seam between the two front ends

The editor's output and the game's content are the same directory. One directory
per level, named by a slug of the level's name:

```
levels/quarry-steps/
  level.xsb    the level, standard XSB
  level.json   { "name": "Quarry Steps" }
  skin.png     the packed atlas        — optional
  skin.json    the manifest for it     — optional
  tiles.json   the cells with art of   — optional, and only with a skin
               their own
```

A directory rather than files with a shared prefix, because the names inside are
then fixed: the game's globs are `/levels/*/level.xsb` and friends,
and a level is paired with its tiles by being in the same directory rather than
by matching file names. Exporting over an existing level replaces the bundle in
place, which includes deleting `skin.png` and `skin.json` when the new export has
no tiles — a level paired with the previous level's art would be worse than
either.

`level.json` exists for one field. XSB has nowhere to put a title — a `Title:`
line is exactly the kind of character the parser refuses — and a slug is a file
name rather than something someone chose to read. Anything else a level grows
later (author, par, a solution) goes in the same file.

### Custom tiles are the level's, not the skin's

`tiles.json` is the cells whose art the author placed by hand — a sheet tile on
one cell, drawn last, over the skin's answer and over the box or player standing
there. That is the opposite of what a binding is, and the two live in different
places for that reason.

```json
{ "width": 16, "height": 12, "tiles": { "34": 6, "35": 7 } }
```

It is level data: `EditorDocument` carries a `customTiles` map beside its
`cells`, so a placement rides on the undo stack, is rewritten by
`resizeDocument` against the new width, and goes away when the document does.
`SkinDraft` never sees it. What it holds is skin data, though — a tile index into
the loaded sheet — which is why loading a sheet or re-slicing one erases every
placement exactly as it clears every binding: an index only means something
against one grid.

The game never has the sheet, only the packed atlas, so the export translates.
`skin/custom-tiles.ts` gives each distinct placed tile one column after the role
columns and hands the same answer to both halves — `atlas.ts` packs those
columns, `tiles.json` points at them — so the image and the file cannot disagree
about which column is which. The manifest's `roles` list is unchanged and still
names column `n`; the custom columns have no name, which is why
`getSkinColumnRect` asks by number.

They ship with the skin rather than beside the level because what they name is
columns in that atlas. A bundle with `tiles.json` and no usable skin has nothing
for them to index, and `host/levels.ts` says so and plays without them.

#### A position is an index into one grid

`tiles.json` names a cell by its flat position, which means the game's grid has
to be the editor's exactly. It nearly isn't: `parseStringToLevelState` trims
blank lines off the top and bottom, so a level whose outer row is all floor —
playable, and only a warning in the editor — would load a row short and shift
every position in it.

So the published `level.xsb` spells floor `-`, XSB's own explicit floor, which is
what `formatDocumentAsPublishedXsb` is for. No row is ever blank, nothing is ever
trimmed, and the grid is exact. Autosave already made the identical substitution
for the identical reason; the XSB textarea keeps spaces, because that one is for
reading.

Belt and braces on top: the file states its own `width` and `height`, and
`parseCustomTileMap` refuses it when they are not the level's. A hand-edited
bundle drawing every tile one cell off would be worse than one drawing none.

#### The preview has a hover marker, so it has a second redraw

Placing a tile needs to show which cell is under the pointer, and skin mode's `update()` is too much to run per pointer move: it repaints the sheet palette and rebuilds fourteen role rows, each carrying the sheet's data url in a `background-image`. So a pointer move that only moved repaints the preview canvas alone, and `update()` is kept for the moves that actually changed the document.

For the same reason the skin's autosave compares state rather than text. The record is dominated by the sheet's data url, and rebuilding that string to find out whether anything changed is the one thing a redraw must not do — so `persist` compares the draft by identity and the data url by reference. Every edit replaces the draft wholesale, and the pure edits return the same object when nothing changed, which makes identity an exact test.

#### Both panels edit the level now

Autosave used to hang off level mode, which was the only thing that changed the
document. Placing a custom tile is a change to the document made from the skin
panel, so the `level` slice's codec, baseline and failure flag moved to
`editor/autosave.ts` and `index.ts` hands one of them to both modes. Still one
owner of the key, which is what keeps the two panels from racing a
read-modify-write on it.

### The tiles are optional, the level is not

A level has to be playable to be exported. A skin does not have to be finished:
an incomplete one exports as a level with no tiles, which the game renders in
flat colour. That asymmetry is the same one validation already makes — every
level is invalid while it is being drawn, and so is every skin, but only one of
them stops the game from loading anything at all.

### Writing it takes a dev server

A browser cannot write to the repository, so `tools/level-export-plugin.ts` adds
a `POST /api/levels` to the Vite dev server and `editor/publish.ts` posts to it.
Serve-only, deliberately: it writes to the working tree, and nothing about it
reaches a built bundle.

The endpoint is where "if valid" is actually enforced. It runs
`parseStringToLevelState` — the game's own parser, imported straight from
`core/` — and refuses anything it would not load, with the parser's own message.
The editor checks the same thing before posting so the failure is immediate, but
the check that matters is the one at the point of writing, because that is the
one nothing can skip.

The slug is derived server-side rather than sent, so the one thing that can name
a path is the one that writes to it. Its shape is also its check: lowercase,
digits and single hyphens, so no name can reach outside `levels/` — `../../etc`
lands in `levels/etc/`.

### The game finds levels by glob, not by index

`host/levels.ts` reads the directory with five eager `import.meta.glob` calls, so
the bundler resolves the list at build time. No index file to keep in step, no
directory listing to fetch, and the built site gets the same content the dev
server shows — a small atlas is inlined as a data url, a large one is emitted as
an asset, and the game does not have to know which.

The cost is that an export is not visible to a game page already open: the glob
is baked into the module, so a newly written level arrives on the next load. The
editor says so when it reports a successful export.

The built-in level from `level-data.ts` is listed alongside them, so a fresh
checkout with nothing exported yet still has something to play.

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
      │        │   ↑         │
      │        │ autosave.ts │            the level slice, for both modes
      │        │   │         │
    canvas.ts  │  storage.ts │            the only localStorage, a leaf
        └──────┴─────┴───────┴→ the DOM: level-mode.ts, skin-mode.ts,
                                publish.ts, index.ts
```

| File              | Role                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.ts`     | `EditorDocument`, `Cell`, `Brush`, `CustomTiles`, and the pure edits: `createEmptyDocument`, `paintDocument`, `setCustomTile`, `resizeDocument` |
| `xsb.ts`          | `parseXsbToDocument` / `formatDocumentAsXsb` — the only text I/O                                                                                |
| `validate.ts`     | `validateDocument(document)` → problems, counts, `isPlayable`                                                                                   |
| `stored-state.ts` | encode / decode of what autosave keeps, for both modes. Pure                                                                                    |
| `session.ts`      | the undo stack, the editor's one mutable value. No DOM                                                                                          |
| `autosave.ts`     | the `level` slice: what the editor opens on, and the write both modes share                                                                     |
| `layout.ts`       | tile size, origin, and pixel → cell. Pure                                                                                                       |
| `canvas.ts`       | `(document, hoverPosition) => draw`. No logic                                                                                                   |
| `storage.ts`      | the three `localStorage` keys, every call guarded. Imports nothing                                                                              |
| `publish.ts`      | the Export to levels/ panel: gate on `validateDocument`, then post the bundle                                                                   |
| `index.ts`        | the mode switch, Clear storage, and the keys and resizes each mode gets                                                                         |

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

The editor writes to `localStorage` on every edit and opens where it was left. Three keys — `sokoban.editor.level`, `sokoban.editor.skin` and `sokoban.editor.publish` — each written only by the one thing that owns that state, so no two of them ever coordinate a read-modify-write of one shared record.

Autosave hangs off each mode's `update()` — the call every edit already ends with — rather than being remembered at each of the dozen places that change something. Each slice holds the text it last stored and compares before writing, which keeps a redraw that changed nothing (a hover, a resize, a mode switch) from writing at all and makes the common case one string compare. No debounce: a level is a few kilobytes of XSB, cheap enough to store per painted cell.

The `level` slice is the one both modes write, because both now edit the document — see "Both panels edit the level now". It lives in `autosave.ts` for that reason, and each mode calls it rather than keeping its own baseline.

The undo stack does not persist. A reload is a new session, and the document is the work.

#### The level is stored as XSB, with `-` for floor

Storing it in the format the editor already reads and writes means there is no second level codec to keep in step. The substitution is the catch: `parseXsbToDocument` trims blank lines off the top and bottom, so a document whose first row is all floor would come back a row shorter. `-` is the XSB alphabet's own explicit floor, so no row is ever blank and the round trip is exact. `stored-state.test.ts` asserts it on exactly that document.

The custom tiles ride alongside the text rather than inside it, as a position → sheet index object, because XSB has nowhere to put them. A record written before they existed simply has none, which is why the stored version did not have to move: the field's absence already means the right thing.

#### A skin is stored with its sheet

A binding is a tile index, which means nothing without the exact image it was cut from, so the sheet travels with the draft as a data url. That is also the string the sidebar thumbnails use, which is why there is no object url left to revoke. Restoring keeps the bindings — unlike loading a sheet, which clears them, because that is new art under the same indices.

A large sheet can exceed the quota. The fallback is to store the draft without the sheet and without the bindings and say so in the status line: the settings survive, the art has to be loaded again. `decodeStoredSkin` drops the bindings whenever the sheet is absent in any case, so a record written before a quota failure — or hand-edited in devtools — cannot come back pointing at nothing.

Nothing is migrated. A record without the current `version` is ignored and the editor opens blank, which for an internal tool's autosave beats guessing at what an older shape meant.

#### Clear storage resets the editor

Clearing the keys without resetting the panels would be a lie, because the next edit autosaves and the state is back. So the button does both, behind a confirm, and `index.ts` owns it: clearing storage is not a level or a skin concern, which is why `EditorMode` has a `reset` for each mode to discard its own half. Each reset moves its "last stored" text along with it rather than writing, so storage stays empty until the next real edit. The level reset goes through `session.replace`, so it lands on the undo stack and Undo brings the level back.

Writes are guarded rather than assumed: storage access throws outright in some embeddings, and a Safari private window accepts reads while refusing writes. A refusal is reported in the status line and the editor keeps working unsaved.

### Publishing belongs to neither panel

A level bundle is both halves of the editor at once — the level from level mode,
the tiles from skin mode — so the Export to levels/ control sits in the top bar
and `index.ts` owns it, for the same reason it owns Clear storage.

The skin stays where it is. `createSkinMode` returns its usual `EditorMode` plus
a `getSkinExport()`, which hands out the packed atlas and manifest rather than
the draft, under exactly the condition that enables the two download buttons.
`publish.ts` therefore never learns how a skin is packed, and skin mode never
learns that publishing exists.

The level's name is stored under its own key rather than with the level, because
it is the publish panel that owns it; clearing storage resets that box too, for
the same reason it resets the panels.

## `editor/skin/` — binds sprites to roles, exports an atlas

Skin mode shares the level document with level mode: the level being drawn is the live preview, which is the only honest way to tell whether a skin reads.

```
render/tile-roles.ts   ROLE_ORDER, TileRole        pure leaves, no imports
render/sheet.ts        the tile grid                 — shared with the game
        ↑
     skin.ts ← atlas.ts                            pure (atlas.ts packs on a canvas)
   ↑  ↑   ↑        ↑
   │  │ custom-tiles.ts   palette-layout.ts        pure
   │  │    ↑              ↑
roles.ts   │             │                         pure
   ↑       │             │
palette.ts │ preview.ts  │                         draw
      └────┴──────┴──────┴→ skin-mode.ts           the only DOM
```

### A skin binds roles, not cells

The game renderer resolves a sprite from state — it never sees a cell's identity — so a skin can say "walls look like this" but not "the wall at (4, 7) looks like this". Clicking the preview with the **bind role** tool therefore binds the role of the cell clicked, via `getTopRoleAtPosition`, and every wall changes at once.

Because a level need not contain every role — there is nothing to click if it has no goals — the role list in the sidebar is a second drop target for the same action. The palette selection is the brush; the preview and the role list are both places to apply it.

The **place tile** and **erase tile** tools are the way out of that: one cell, one tile, over whatever the skin decided. That is per-cell art, which is level data rather than skin data, and it lives on the document — see "Custom tiles are the level's, not the skin's".

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

### The palette zooms by growing its canvas, not by transforming it

`computeSheetLayout` takes a zoom that multiplies the fit-to-view scale and reports the canvas size that holds the result. The canvas is sized to that and sits in a scroll container, so panning is the browser's and the pointer handler keeps inverting one scale and origin rather than a second transform on top. Zoom being a multiple of the fit also caps the canvas at the view's size times the zoom, whatever the sheet's dimensions, so a large tileset cannot zoom its way into an allocation the browser refuses.

It is a view setting rather than skin data, so it is not stored with the draft.

### One vocabulary for every sheet, including our own output

`SheetSettings` is `tileWidth`, `tileHeight`, `margin`, `spacing` — enough to slice essentially any tileset. The exported atlas is described with the same four numbers, and the game cuts our output with the identical arithmetic because it is the identical module: `render/sheet.ts`, which both sides import.

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
- `editor/` imports nothing from `host/`, and `host/` imports nothing from `editor/`. The two front ends meet only in `core/`, in `render/`, and in `levels/` on disk.
- `render/colors.ts` and `render/tile-roles.ts` are leaves that import nothing; `render/sheet.ts` and `render/skin.ts` import only each other and those leaves. They exist so the level you draw looks like the level you play, and so the editor and the game agree on what a role is and how a sheet is cut, without the editor depending on the game's renderer.
- The DOM lives only in `host/index.ts`, `editor/index.ts`, `editor/level-mode.ts`, `editor/skin-mode.ts` and `editor/publish.ts`. Everything under `editor/skin/` is pure or draws into a canvas it was handed.
- `localStorage` lives only in `editor/storage.ts`, which holds the keys and swallows the browser's failure modes. What goes in them is `editor/stored-state.ts`, which is pure and tested; the game stores nothing.
- The file system lives only in `tools/level-export-plugin.ts`, which runs in the dev server and never in a browser or a build. It is also the only place a path is built from user input, which is why it derives the slug itself.
- `tools/` may import `src/core/`, and nothing else may import `tools/`.
- `editor/index.ts` is a mode switch and nothing else: it owns which panel is visible, routes keys and resizes to it, and builds the two things neither panel owns — the level autosave and the publish panel.
- A skin binds a role; a custom tile names a cell. The first lives in `SkinDraft`, the second on `EditorDocument`, and no module holds both.

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

The editor's pure modules are tested the same way, with XSB as the language in both directions — `parseXsbToDocument` in, `formatDocumentAsXsb` out, so a brush test is two boards. The custom tiles are the exception, because XSB cannot spell them: those assertions read the map. `layout.ts` and `canvas.ts` are untested: one is three lines of arithmetic the pointer handler and the renderer share, the other is drawing.

`render/skin.test.ts` covers the seam between the editor's output and the game's input: that a manifest resolves to the columns the atlas was packed with, that an unbound wall piece falls back to the wall fill, that an unrecognised role still consumes its column, and that a column past the ones `roles` names still cuts. The atlas it tests against is two numbers, because its size is all a skin reads off the image.

`skin/custom-tiles.test.ts` covers the other half of that seam the only way worth doing it: `formatCustomTilesFile` out, `parseCustomTileMap` — the game's own reader — back in, asserted against the packing. A column that survives the file is the whole promise, and asserting either side against a literal would not make it.

`host/levels.ts` and `editor/publish.ts` are untested, and so is the export endpoint. They are I/O, and the one thing worth asserting about them — that only a level the game can load is ever written — is asserted by `parseStringToLevelState`, which the endpoint calls and `core/level.test.ts` already covers from both directions.

## Naming

Identifiers are spelled out: `playerMoveDirection` not `dir`, `destination` not `dest`, `context` not `ctx`, `character` not `char`, `position` not `i`.

The only short names left are `x` and `y` for grid coordinates, where the single letters are the convention rather than a contraction.

## Deferred decisions

- `step` returns only the new state, not `{ state, events }`. Animation and sound will need either a diff of consecutive states or an event channel; that choice is postponed until one of them is actually built.
- Level sets. `levels/` holds one level per directory, which is what the editor produces; a downloaded `.sok` collection is many levels in one file. Reading those needs a pure `parseCollection(text)` in `core/level.ts` to split the file and strip its `Title:` / `Author:` metadata, and a second shape in the catalog for "a directory of levels that share a skin". `parseStringToLevelState()` itself would not change. Not built, because nothing in the repository is a collection yet.
- Progress. Nothing records which levels have been solved, so the picker shows no state. It is one key in `localStorage` keyed by slug, once there is a reason to want it.
- Redo is not wired up. The history stack already supports it; it needs a forward stack and a key.
