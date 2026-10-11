# Architecture

The game logic is a pure state transition function; everything else is a thin shell around it. Two front ends sit on top — the game and the level editor — and they meet in three places and no others: `core/`, `render/`, and the `levels/` directory the editor writes and the game plays.

```
index.html     the game
editor.html    the level editor
levels/        one directory per level — what the editor exports and the game plays,
               plus order.json, the campaign order, and default-skin.json

src/core/       types.ts, level.ts, step.ts, rules.ts   pure, no DOM, no I/O
src/host/       index.ts, history.ts, levels.ts,        screens, history stack,
                level-data.ts, level-order.ts,          keybindings, dispatch,
                default-skin.ts,
                save.ts, menu.ts, dev-tools.ts          campaign and save
src/render/     canvas.ts, colors.ts, tile-roles.ts,    (state) => draw
                sheet.ts, skin.ts, layers.ts
src/editor/     document.ts, xsb.ts, validate.ts,       level mode, same pure/shell/draw split
                session.ts, layout.ts, canvas.ts,       plus autosave:
                level-mode.ts, dom.ts, zoom.ts,         stored-state.ts, autosave.ts,
                index.ts, publish.ts, tint.ts           storage.ts — and the export to levels/
                colors-mode.ts, color-palettes.ts,      colours mode: palettes kept beside
                color-palette-library.ts, hex.ts,       the level, for both colour panels
                swatches.ts
src/editor/skin/ skin.ts, roles.ts, atlas.ts,           skin mode
                 layers.ts, palette.ts,
                 palette-layout.ts, preview.ts,
                 tinted-tiles.ts
tools/          level-export-plugin.ts                  the dev-server endpoint publish.ts posts to
```

TypeScript, built with Vite. `npm run verify` checks everything (format, lint,
knip, types, tests).

| Command                | What it does                         |
| ---------------------- | ------------------------------------ |
| `npm run game`         | the game as players get it, on :5173 |
| `npm run dev`          | the game plus dev tools, on :5175    |
| `npm run editor`       | the level editor, on :5174           |
| `npm run build`        | ships the game to `dist/`            |
| `npm run build:editor` | builds the editor to `dist-editor/`  |

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
- `history.ts` also keeps the path as LURD — uppercase for a push, so the push count is read off it — and `restoreHistory(initial, lurd)` replays a saved path back into a full history, undo stack included, or returns null when the level refuses it.
- `level-order.ts` — `levels/order.json` read and applied. Pure.
- `default-skin.ts` — `levels/default-skin.json` read and applied: the skin a level without one borrows. Pure.
- `save.ts` — the save format, where Continue resumes, and the guarded `localStorage` access. Pure apart from the two storage calls.
- `menu.ts` — the menu every screen uses: arrows or W/S and Enter, or the mouse, one highlight for both.
- `index.ts` — the screens, the clock, saving, keybindings and the HUD. Re-renders when `run` reports a change.
- `dev-tools.ts` — the dev build's extras, loaded only by `npm run dev`.

No game rules live in any of them.

### The game is a campaign

Title, board, finale. The title offers **Continue** when the save has a level
in progress and **New Game** always — behind a confirmation when there is
progress to lose. A new game plays the levels in `levels/order.json` order, one
after another; solving one shows a level-complete panel over the board with its
moves, pushes and time, and solving the last one leads to the finale, which
lists every level's result and the totals. Escape on the board saves and goes straight back to the title, where Continue picks the level up again.

`index.ts` holds one `play` — the level, its history, its renderer and its
clock — and it is null while no board is up. One `activeMenu` takes the keys
whenever a menu is on screen, title or panel alike, so the arrows drive
exactly one thing at a time.

The renderer is built per level rather than once for the canvas, because the
skin belongs to the level: `createRenderer(canvas, level.skin, level.layers)`
draws that bundle's tiles, and `createRenderer(canvas, null)` draws the
procedural palette for a level that shipped without any.

#### The save

One `localStorage` key holds the level in progress — its slug, its path as
LURD, and its time — and every solved level's result. It is written on every
move, on leaving the board, when the tab is hidden, and once a second while the clock
runs, so a reload's Continue lands on the same level, in the same position,
with the same undo stack, counts and clock. Solving a level moves the save on
to the next one at once, so a reload from the level-complete panel does not
replay the level just solved.

Levels are named by slug rather than by place, so reordering the campaign never
moves a player onto a level they did not play. A saved slug that has gone
resumes at the first unsolved level; a saved path the level no longer accepts —
it was re-exported — starts that level over rather than guessing.

The clock runs only while the board is on screen, nothing covers it, the tab is
visible and the level is unsolved.

#### The dev build

`npm run dev` is `vite --mode devtools`. `index.ts` imports `dev-tools.ts` behind
`import.meta.env.MODE === 'devtools'`, which a production build folds to false,
so no dev code or style reaches `dist/`. It adds:

- **Levels (dev)** on the title: every level as a card — a miniature drawn by
  the game's own renderer, its slug and its tiles — in campaign order. Drag a
  card, or use ↑ ↓, to reorder; each change is posted to `/api/level-order`,
  which `tools/level-order-plugin.ts` writes to `levels/order.json`. The
  plugin swallows the HMR update for its own write, so the page that saved the
  order is not reloaded under the author. **Play from here** starts a fresh
  run at that level.
- **Default skin**, a picker on the same screen: which level's skin every level
  without one of its own is drawn with. Each choice is posted to
  `/api/default-skin`, which `tools/default-skin-plugin.ts` writes to
  `levels/default-skin.json` — `{ "from": "<slug>" }`, or `null` for flat
  colour — and the cards are rebuilt with it. The game reads the file on start,
  built site included, so the choice ships.
- **Win level**, a button under the board and the N key: the level counts as
  solved with its current moves and time.

The dev build saves under its own key, on its own port, so it never touches a
player's save.

Undo is deliberately outside engine state. Because `step` is pure, keeping a stack of previous states gives undo, redo, and replay for free, and the engine stays simple.

Illegal moves are detected by identity: `step` returns the same object when nothing changed, so `next === current()` means the move was rejected and no history entry is recorded. That identity contract is load-bearing, and `step.test.ts` asserts it with `toBe` rather than `toEqual`.

Keys: arrows or WASD to move, Z or U to undo, R to reset, Escape for the title screen. In menus, arrows or W/S to choose and Enter or Space to pick.

## `render/` — dumb

`createRenderer(canvas, skin, layers)` returns a `render(levelState): void` that redraws the whole board. Reads `level.wallMap` and `level.goalPositions` for the board, and `playerCurrentPosition` and `boxPositions` for the movable pieces. The layer stack is the one thing it is given that is not a function of state — the level's draw order and its hand-placed art, fixed for its lifetime, which is why it is a constructor argument like the skin. No event listeners, no game logic, no knowledge of history.

Full redraw every time is deliberate: it keeps the renderer a pure function of state with nothing to invalidate, and a Sokoban board is small enough that the cost is irrelevant.

| File            | Role                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `canvas.ts`     | the two painters — tiles when there is a skin, flat colour when there is not — over the level's ground             |
| `colors.ts`     | the palette, and `readHexColor` — the one way a colour the author picked arrives from outside. A leaf              |
| `tile-roles.ts` | `ROLE_ORDER`, `TileRole`, and the wall classifier, a leaf                                                          |
| `sheet.ts`      | how to cut a grid of tiles out of an image. Pure                                                                   |
| `skin.ts`       | a manifest parsed, bound to its atlas, and resolved to a rect per role — or per column, for the custom tiles. Pure |
| `layers.ts`     | the `tiles.json` format: the built-in layers, the stack, and the reader. A leaf                                    |

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
  level.json   { "name": "Quarry Steps", "groundColor": "#1a2b3c" }
  skin.png     the packed atlas        — optional
  skin.json    the manifest for it     — optional
  tiles.json   the layer stack and the  — optional, and only with a skin
               art painted on it
```

A directory rather than files with a shared prefix, because the names inside are
then fixed: the game's globs are `/levels/*/level.xsb` and friends,
and a level is paired with its tiles by being in the same directory rather than
by matching file names. Exporting over an existing level replaces the bundle in
place, which includes deleting `skin.png` and `skin.json` when the new export has
no tiles — a level paired with the previous level's art would be worse than
either.

`level.json` is everything about a level that is not its cells. XSB has nowhere
to put a title — a `Title:` line is exactly the kind of character the parser
refuses — and a slug is a file name rather than something someone chose to read.
The ground colour is there for the same reason, and anything else a level grows
later (author, par, a solution) goes in the same file. Both fields are read
leniently: a missing or malformed name falls back to the slug, and a ground
colour that is not `#rrggbb` reads as no ground, because a colour the canvas
would reject silently is worse than one that was never there.

### The ground colour is the level's backdrop

A level may name one colour that sits under everything: it fills the cells the
silhouette culls, it shows through every transparent pixel the skin has, and a
level with a ground and no tiles at all is that colour and nothing else. That
last case is the point — it is what makes a stencil sheet usable, where the art
is shape and the colour has to come from somewhere.

It is level data rather than skin data, so it rides in `level.json` beside the
name:

- It means the same against any sheet, so unlike a binding nothing invalidates
  it — not loading a sheet, not re-slicing one, not a resize.
- A level published with an unfinished skin has no `skin.json` at all, and
  losing its backdrop with its tiles would be wrong: the ground is what the
  level is drawn onto, not one of the things drawn on it.
- Nothing can bind it and no art names it. It is not a tile, so it does not take
  a role or a column.

In the game it is a `createRenderer` argument like the skin and the layer stack
— the level's own, fixed for its lifetime, rather than anything read off the
state — and `prepareCanvas` lays it down, so a skinned and an unskinned board
are over the same ground. It covers the board's own rectangle rather than the
whole canvas: it is the level's backdrop and not the page's, so the letterboxing
around a board whose shape does not match the canvas stays the page's colour.

It is also the one colour the game learns, which is the exception to "colour is
baked into the atlas" below — and it has to be, because there are no pixels for
it to be baked into. A fill is not art.

In the editor it lives on `EditorDocument` for the same reasons a placement
does: it rides the undo stack, it is written by the `level` autosave slice, and
it goes away when the document does. The control sits in skin mode's sidebar
next to the ink all the same, because what it is for is what shows through a
transparent tile — the same "both panels edit the level" arrangement the custom
tiles have. Level mode's own canvas does not draw it, because there every floor
is an opaque flat colour and nothing would show.

A colour input fires `input` for every shade dragged through, so one visit to
the picker is one undo entry: the first event opens a stroke and `change`
closes it, which is the picker's own gesture for what a drag across cells gets
from `beginStroke`. "No ground" is a real absence rather than a colour that
happens to change nothing — the way `NO_TINT` is — so the row has a `×` beside
the swatch, and the picker keeps its colour afterwards so clearing and picking
again does not start from black.

### Layers are the level's, not the skin's

`tiles.json` is the level's draw order: an explicit stack of layers, bottom first, the way a tile editor has them. Five of them are built in and drawn from the state — `floor`, `walls`, `goals`, `boxes`, `player` — and any number of art layers sit among them, each a sparse map of cells the author painted a sheet tile on. Without the file a level draws in the built-in order, which is what the renderer used to hardcode.

```json
{
  "width": 16,
  "height": 12,
  "layers": [
    { "builtIn": "floor" },
    { "name": "rugs", "tiles": { "34": 6 } },
    { "builtIn": "walls" },
    { "builtIn": "goals" },
    { "builtIn": "boxes" },
    { "builtIn": "player" },
    { "name": "canopy", "tiles": { "35": 7 } }
  ]
}
```

Every stack holds each built-in exactly once. They can be moved anywhere — the player under a canopy layer, a rug layer between the floor and the walls — but not removed, because a stack without `walls` is a level with no walls on screen and never what an author meant. `parseLayerStack` refuses a file that misses or doubles one, and the level plays in the default order instead.

There used to be a per-cell `onTop` / `overwrite` mode. Layers replace it: an art layer can sit anywhere in the stack, so "under" or "over" the skin is where the layer is rather than a flag on each cell. The one thing overwrite did that layers cannot — a transparent tile punching a hole through the skin on one cell — was dropped deliberately; an opaque tile on a higher layer covers a cell just as well.

It is level data: `EditorDocument` carries `layers` beside its `cells`, so a placement or a reorder rides on the undo stack, art is rewritten by `resizeDocument` against the new width, and all of it goes away when the document does. `SkinDraft` never sees it. What an art tile holds is skin data, though — a tile index into the loaded sheet — which is why loading a sheet or re-slicing one erases every placement on every layer exactly as it clears every binding: an index only means something against one grid. The layers themselves stay; their order and names mean the same against any sheet.

An art layer has an `id` (`art-1`, `art-2`, …) as well as a name, because the name is something the author edits and an index moves every time the stack is reordered. `getNextArtLayerId` hands out one past the highest in use, so an undo can never bring back a layer whose id was given to another.

The game never has the sheet, only the packed atlas, so the export translates. `skin/layers.ts` gives each distinct placed tile one column after the role columns, across every art layer, and hands the same answer to both halves — `atlas.ts` packs those columns, `tiles.json` points at them — so the image and the file cannot disagree about which column is which. The manifest's `roles` list is unchanged and still names column `n`; the custom columns have no name, which is why `getSkinColumnRect` asks by number. An art layer with nothing on it is not exported, and a level whose stack is the default order with no art ships no `tiles.json` at all.

They ship with the skin rather than beside the level because what art names is columns in that atlas. A bundle with `tiles.json` and no usable skin has nothing for it to index, and `host/levels.ts` says so and plays in the default order.

`render/layers.ts` is where the format itself lives — the built-in ids, the stack, and the reader — as a leaf that imports nothing, like `colors.ts` and `tile-roles.ts`. Both sides need the vocabulary and neither may depend on the other: the editor authors a stack and writes the file, the game reads it and draws it.

#### The layers panel is a view of the stack, not part of it

Skin mode's sidebar lists the stack top first, as every layer panel does. Each row has a visibility switch, a solo button that shows that layer alone, and up and down; an art layer also has its name, its tile count and a delete. **show all** clears every switch.

Visibility and solo are view state, like the zoom: a hidden layer is still exported and still drawn by the game, so they are not on the document and not on the undo stack. Reordering, adding, deleting and renaming are edits, one undo entry each.

The selected row is where **place tile**, **erase tile** and **recolor** paint, and where **+ layer** inserts. Any row can be selected, so a new layer can go anywhere, but only an art layer can be painted — with a built-in one selected the tools do nothing and the report says why. The selection is resolved against the document on every redraw, because an undo can take the selected layer away; it falls back to the topmost art layer.

The preview draws the document's own stack in order, with the same culling as the game — built-in layers stop at the board's silhouette, art does not — so what the panel shows is what the game will draw.

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
`parseLayerStack` refuses it when they are not the level's. A hand-edited
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

The order comes from `levels/order.json`, a list of slugs, read by a sixth
glob so a checkout without one still builds. A level it does not name — one
just exported — plays after the listed ones, so a new level is never invisible;
a slug with no level is skipped and reported.

`levels/default-skin.json` is read by a seventh glob, for the same reason. It
names a level whose skin is lent to every level that shipped none. Only the
role columns travel: art layers name cells of the lender's own grid, so a
borrower draws in the default layer order. The lender's ground colour travels
too, but only to a level whose `level.json` names none, because the skin was
drawn against it. `PlayableLevel` keeps what the level brought (`ownSkin`,
`ownGroundColor`) beside what it draws with (`skin`, `groundColor`), so choosing
again starts from the bundle rather than the last choice. A slug with no skin
to lend is reported and lends nothing.

The built-in level from `level-data.ts` is a fallback only: it is played when
`levels/` has nothing loadable, so a fresh checkout still has something to
play, and never appears beside exported levels.

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
    canvas.ts  zoom.ts  │  storage.ts │   localStorage: a leaf
        └─────────┴─────┴──────┴──────┴→ the DOM: level-mode.ts, skin-mode.ts,
                                         colors-mode.ts, publish.ts, index.ts

The colour palettes hang off the same spine, with their own slice:

```

render/colors.ts the hex format, shared
↑
hex.ts color-palettes.ts pure
│ ↑
│ color-palette-library.ts mutable, no DOM — the slice
│ │
└── swatches.ts ─┴→ colors-mode.ts, skin-mode.ts the DOM

```

| File               | Role                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.ts`      | `EditorDocument`, `Cell`, `Brush`, `CustomTiles`, and the pure edits: `createEmptyDocument`, `paintDocument`, `setCustomTile`, `setGroundColor`, `resizeDocument` |
| `xsb.ts`           | `parseXsbToDocument` / `formatDocumentAsXsb` — the only text I/O                                                                                                  |
| `validate.ts`      | `validateDocument(document)` → problems, counts, `isPlayable`                                                                                                     |
| `stored-state.ts`  | encode / decode of what autosave keeps, for both modes. Pure                                                                                                      |
| `session.ts`       | the undo stack, the editor's one mutable value. No DOM                                                                                                            |
| `autosave.ts`      | the `level` slice: what the editor opens on, and the write both modes share                                                                                       |
| `layout.ts`        | tile size, origin, the canvas size a zoom needs, and pixel → cell. Pure                                                                                           |
| `canvas.ts`        | `(document, hoverPosition, zoom) => draw`. No logic                                                                                                               |
| `zoom.ts`          | the zoom shared by the three scrolling views: two buttons, ctrl + wheel, scroll anchoring, and where the steps stop                                               |
| `backing-store.ts` | the canvas resize all three zooming painters share, and the pixel budget the zoom stops at                                                                        |
| `storage.ts`       | the four `localStorage` keys, every call guarded. Imports nothing                                                                                                 |
| `publish.ts`       | the Export to levels/ panel: gate on `validateDocument`, then post the bundle                                                                                     |
| `index.ts`         | the mode switch, Clear storage, and the keys and resizes each mode gets                                                                                           |
| `hex.ts`           | hex as an author types and pastes it: `parseHexColor`, `parseHexColors`, `formatHexColors`. Pure                                                                   |
| `color-palettes.ts` | `ColorPalette`, `ColorPaletteLibrary`, and the pure edits on them. Pure                                                                                           |
| `color-palette-library.ts` | the `palettes` slice: what the editor opens on, and the write colours mode makes                                                                           |
| `swatches.ts`      | the swatch list both colour panels draw, and the reader for a click on one                                                                                        |
| `colors-mode.ts`   | the colours panel: the library, one picker, and the paste box                                                                                                     |

`backing-store.ts` is left out of the diagram to keep it readable: it is a leaf under `canvas.ts` and `zoom.ts`, and under the two painters in `skin/` as well, which is the point of it — the pixel budget the zoom stops at and the resize that honours it are one number in one place.

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

The editor writes to `localStorage` on every edit and opens where it was left. Four keys — `sokoban.editor.level`, `sokoban.editor.skin`, `sokoban.editor.publish` and `sokoban.editor.palettes` — each written only by the one thing that owns that state, so no two of them ever coordinate a read-modify-write of one shared record.

Autosave hangs off each mode's `update()` — the call every edit already ends with — rather than being remembered at each of the dozen places that change something. Each slice holds the text it last stored and compares before writing, which keeps a redraw that changed nothing (a hover, a resize, a mode switch) from writing at all and makes the common case one string compare. No debounce: a level is a few kilobytes of XSB, cheap enough to store per painted cell.

The `level` slice is the one both modes write, because both now edit the document — see "Both panels edit the level now". It lives in `autosave.ts` for that reason, and each mode calls it rather than keeping its own baseline.

The `palettes` slice is the same arrangement one step further out: colours mode edits it and skin mode reads it, so it lives in `color-palette-library.ts` and is handed to both. It compares by identity rather than by text, like the skin's baseline does — every edit in `color-palettes.ts` returns the library it was given when it was a no-op, so identity is exact and a redraw that changed nothing costs a pointer compare.

### Live link from the colour picker

The theme colour picker (`../theme-color-picker`) can push its open set to the editor so role colours follow it without copy and paste. The picker is another origin, so it posts to `/api/live-colors` on the editor's dev server; `tools/live-colors-plugin.ts` keeps the last set (for a GET from a page that opens later) and relays it down the HMR socket as a `live-colors` event. `editor/live-colors.ts` is the page's end, and skin mode's **follow colour picker** toggle applies each set through the same path as the Import colors from JSON dialog. The toggle is remembered in the `live` slice. A burst of sets from a drag folds into one undo entry for the ground. Dev only: a built editor has no `import.meta.hot` and hides the toggle.

The undo stack does not persist. A reload is a new session, and the document is the work.

#### The level is stored as XSB, with `-` for floor

Storing it in the format the editor already reads and writes means there is no second level codec to keep in step. The substitution is the catch: `parseXsbToDocument` trims blank lines off the top and bottom, so a document whose first row is all floor would come back a row shorter. `-` is the XSB alphabet's own explicit floor, so no row is ever blank and the round trip is exact. `stored-state.test.ts` asserts it on exactly that document.

The layers ride alongside the text rather than inside it — a built-in as its id, an art layer as its id, name and a position → sheet index object — because XSB has nowhere to put them. A record written before custom tiles existed simply has none, and one written before layers has a single `customTiles` map, read as the default stack with that map on its art layer — which is why the stored version did not have to move. The ground colour rides alongside for the same reason and reads back the same way — no ground is what an older record was drawn with.

#### A skin is stored with its sheet

A binding is a tile index, which means nothing without the exact image it was cut from, so the sheet travels with the draft as a data url. That is also the string the sidebar thumbnails use, which is why there is no object url left to revoke. Restoring keeps the bindings — unlike loading a sheet, which clears them, because that is new art under the same indices.

A large sheet can exceed the quota. The fallback is to store the draft without the sheet and without the bindings and say so in the status line: the settings survive, the art has to be loaded again. `decodeStoredSkin` drops the bindings whenever the sheet is absent in any case, so a record written before a quota failure — or hand-edited in devtools — cannot come back pointing at nothing.

Nothing is migrated. A record without the current `version` is ignored and the editor opens blank, which for an internal tool's autosave beats guessing at what an older shape meant.

#### Clear storage resets the editor

Clearing the keys without resetting the panels would be a lie, because the next edit autosaves and the state is back. So the button does both, behind a confirm, and `index.ts` owns it: clearing storage is not a level, a skin or a palette concern, which is why `EditorMode` has a `reset` for each mode to discard its own third. Each reset moves its "last stored" text along with it rather than writing, so storage stays empty until the next real edit. The level reset goes through `session.replace`, so it lands on the undo stack and Undo brings the level back.

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

### Colour palettes are kept beside the level, not in it

A palette is a named list of hexes an author keeps across a level — the inks a sprite set is drawn with, the ground it sits on, the ramp a tileset came from. Nothing in a level or a skin refers to one: it is a place to put colours so they can be copied back out, which is why it is its own mode and its own storage key rather than a field on either.

That is also why palettes are not on the undo stack. The stack is the document's, and the document knows nothing about them, so deleting a palette asks first instead — the same deal Clear storage gets, for the same reason: the panel holds the only copy.

"Palette" already meant the grid a tile sheet is cut into, in `skin/palette.ts`. The colour kind therefore says `colorPalette` in full everywhere — `ColorPalette`, `colors-mode.ts`, `#palette-swatches` against the older `#sheet-palette` — so neither ever reads as the other.

#### Hex is widened on the way in, never on the way out

`readHexColor` in `render/colors.ts` stays the one format the program stores: `#rrggbb` lowercase, because that is what a colour input and a canvas both take. But nobody types the `#`, palette sites hand out bare `1a1c2c`, and CSS is full of `#fff`, so `hex.ts` is the one widening — and it widens *into* `readHexColor` rather than around it, so every colour still leaves through the single gate.

`parseHexColors` tokenises the pasted text rather than scanning it for hex-looking windows, because a token has to be a colour whole: `#ffffffaa` is a format this program does not have, and finding `#ffffff` inside it would silently drop the alpha instead of saying it could not be read. The cost is that a word spelled in hex letters is a colour; the box says "paste hex colours", and the count that comes back is how an author sees it happen.

#### A colour field is never written to while it is focused

There are four of them — the ink, the ground, the colours panel's picker, and one per bound role in the skin sidebar — and each is two controls over one value: a swatch and a hex field, each following the other. The trap is the redraw: typing `#1a1c2c` passes through `1a1`, which is a valid shorthand, so the live edit commits `#11aa11` and the redraw would write that back over the three characters typed so far, leaving the author typing into the middle of a colour they did not choose.

So no write-back touches a focused field. The three standalone ones guard on `document.activeElement`; the role fields cannot, because `renderRoleList` rebuilds all fourteen rows from scratch on every redraw and the element itself is replaced — so the one being typed in is carried across, text and caret and focus together, and the rest are drawn from the draft as usual. Rebuilding is still the right call there: reconciling fourteen rows to keep one caret would be much more machinery than remembering where it was.

A field squares up with the value it was editing on `change`, which is written explicitly at each of them rather than left to the redraw — `change` also fires on Enter, which does not blur, and the redraw's job is the opposite one. Enter itself is wired to blur the field (`commitFieldOnEnter`), because a text input fires `change` on Enter only inside a form and none of the editor's are.

The ground's live edits coalesce into one undo entry per visit, from either control — `isEditingGround` is opened by the first edit and closed by the picker's `change` or the field's. Without it, typing a hex would push one undo entry per keystroke that happened to parse.

#### A role's colour is pasted onto it, not stamped from the ink

Each bound role carries a second line under its tile: the current ink as a stamp, its own colour as a hex field, and that hex to copy out. The hex field is the short way round from a palette — copy there, paste here — with no trip through the ink picker and no second click.

It is a second line because the first is already a thumbnail, a label as long as "corner bottom-right" and a tile index inside a 320px sidebar. Pasting sets the colour and leaves the mode alone, because the mode is a fact about the art rather than about the colour: a flat-inked stencil stays flat when it is recoloured. The stamp button is still how a mode changes, since it carries the whole ink.

The hex is deliberately _not_ spelled in its own colour, unlike the glyph beside it. Half of any palette is darker than the panel, and a hex written in its own colour is a hex that cannot be read; the glyph can afford to be dark because it is a shape, not a word.

## `editor/skin/` — binds sprites to roles, exports an atlas

Skin mode shares the level document with level mode: the level being drawn is the live preview, which is the only honest way to tell whether a skin reads.

```

render/tile-roles.ts ROLE_ORDER, TileRole pure leaves, no imports
render/sheet.ts the tile grid — shared with the game
editor/tint.ts Tint, the ink vocabulary — editor-only, see below
↑
skin.ts ← atlas.ts ← tinted-tiles.ts pure (the last two use a canvas)
↑ ↑ ↑ ↑ ↑
│ │ layers.ts palette-layout.ts pure
│ │ ↑ ↑
roles.ts │ │ pure
↑ │ │
palette.ts │ preview.ts │ draw
└────┴──────┴──────┴→ skin-mode.ts the only DOM

```

### A skin binds roles, not cells

The game renderer resolves a sprite from state — it never sees a cell's identity — so a skin can say "walls look like this" but not "the wall at (4, 7) looks like this". Clicking the preview with the **bind role** tool therefore binds the role of the cell clicked, via `getTopRoleAtPosition`, and every wall changes at once.

Because a level need not contain every role — there is nothing to click if it has no goals — the role list in the sidebar is a second drop target for the same action. The palette selection is the brush; the preview and the role list are both places to apply it.

The **place tile**, **erase tile** and **recolor** tools are the way out of that: one cell of one art layer, one tile, over or under whatever the skin decided depending on where that layer sits. That is per-cell art, which is level data rather than skin data, and it lives on the document — see "Layers are the level's, not the skin's".

### Colour is the author's, and it is baked into the atlas

A monochrome tile sheet has no colour in it to adjust — `levels/monochrome/skin.png` is literally two values, `#f9fafb` and transparent — so the colour is not an adjustment to the art, it is a thing the author has to say. A **tint** is that: a colour and a mode, picked in the sidebar as the **ink** the next bind or placement is made with.

**One operation, not two.** `multiply` keeps the art's own shading and darkens it toward the colour; `flat` keeps nothing but the tile's alpha and repaints every pixel it has. That covers both halves of the question with one control, because the two modes fail in opposite directions:

| source                | multiply by white | multiply by C   | flat C                       |
| --------------------- | ----------------- | --------------- | ---------------------------- |
| a stencil (white ink) | unchanged         | **≈ C**         | **exactly C**                |
| multicoloured art     | **unchanged**     | shaded toward C | repainted flat, shading lost |

Multiplying by white is the no-op, which is why "no tint" is a value rather than an absence: nothing has an optional field to branch on, and a tile never tinted is the same tile as one tinted back to white. Multiply can only ever darken — `flat` is there because that is a real limit, not because a stencil could not be done with multiply. For a tile whose ink is already white the two are indistinguishable, which is exactly why the author picks rather than the editor inferring.

Hue and saturation sliders, and palette remapping, are deliberately absent: on multicoloured art they are numbers you cannot predict per tile, and the stencil case — the one that actually prompted this — does not need them.

**The game never learns what a tint is.** `tintSheetTile` is applied when the atlas is packed, so a tint ships as pixels. (The ground colour is the one colour the game is told — see "The ground colour is the level's backdrop". It has no art to be baked into, which is exactly what makes it the exception rather than a crack in the rule.) `skin.json` and `tiles.json` are byte for byte what an untinted skin writes, `render/` stays `(state) => draw` with no tint cache and no per-frame compositing, and there is no colour for a bundle's loader to validate. What it costs is that a column is a tile _and_ an ink, so one sprite placed in two inks is two atlas columns — bounded by the number of distinct inks, which is small for hand-placed art and zero for role bindings, since those get a column each regardless. It also means an exported atlas cannot be re-tinted, and nothing can tint at runtime; the editor is the authoring tool and holds the draft in autosave, so re-exporting is the undo, and no runtime effect wants this today.

`tintSheetTile` returns a tile of its own rather than tinting at the draw call, because the export has to extrude the tinted _edges_ and the preview has to scale them — both need the finished pixels in isolation, with no neighbour in the sheet to sample. Every path goes through it, the identity tint included, so the preview, the sidebar thumbnails and the exported atlas cannot be different pixels; `createTintedTileCache` is what makes that affordable, since the preview repaints the whole board on every pointer move.

A blend mode still composites source-over, so filling an opaque colour over a `multiply` would paint the tile's _transparent_ pixels too — turning a stencil into a block. So multiply fills and then takes the alpha back off the tile itself with `destination-in`, which is why the source is drawn twice. `flat` needs only `source-in`, which keeps the destination's alpha and takes the source's colour.

#### Where a tint lives: two homes, because they answer different questions

`SkinDraft.tints` is a second map beside `bindings` rather than a field on one, because the two are invalidated by different things. A tile index only means something against one grid, so re-slicing drops every binding; a colour means the same against any grid, so `clearBindings` leaves the palette alone and rebinding comes back to the colours already chosen. An ink also outlives `unbindRole` — it is the author's choice for that role, not a property of whatever tile happened to be there.

A `CustomTile`'s tint, by contrast, is a field on the placement, because there it genuinely is per cell: two cells can hold the same sprite in different colours. Two parallel maps would have to be kept in step through a resize and an erase for no gain.

Neither moved `STORED_VERSION`. A record written before tints existed has none, and no tint reads as the identity, so the field's absence already means what the old record meant — and layers did not move it either: a record with `customTiles` and no `layers` reads back as the default stack with those placements on its art layer, which is what it drew.

**recolor** is its own tool because re-stamping a cell to change its ink would need the original tile still selected and would quietly replace the art if it were not. It is idempotent, so it can be dragged across a row without flickering.

### Fourteen roles: six required, eight optional

`ROLE_ORDER` in `render/tile-roles.ts` is the single source of truth: `TileRole` is derived from it, so a role cannot exist without a column in the atlas, and `EMPTY_BINDINGS` is built from it so a new role cannot be missing from a draft.

The six in `REQUIRED_ROLES` gate an export. The eight in `WALL_VARIANT_ROLES` — four sides, four corners — are optional refinements, and `getBaseRole` sends any unbound one to `wall`. That is what keeps a six-tile skin rendering every wall, and what lets the editor offer both a quick flat skin and a fully pieced one without a second format.

`boxOnGoal` earns its own tile because it is the only "this one is done" signal on the board. `playerOnGoal` does not exist: goal is drawn on the ground layer and the player composites over it.

### Wall pieces are named for the frame, not the exposed face

A piece is named for where it sits in the wall **around** the floor. Floor to the south means the cell caps the wall above that floor, so it takes `wallTop` — not `wallBottom`. Getting this backwards renders every room inside out, with each wall's cap facing away from the player.

### Wall classification needs all eight neighbours

Four will not do, and the reason is the shape the pieces exist for:

```

##### The corners of a one-cell-thick border have no

# # orthogonally adjacent floor — only diagonal. Four

# # neighbours cannot tell a corner from a buried block.

#####

```

So `getWallRole` takes a `WallNeighbourhood` of eight booleans and resolves in that order of specificity: one open side is an edge, no open side but an open diagonal is a corner, nothing open at all is the fill.

Two or more open sides is a thin wall or an inner corner, and nine pieces have no tile for either; those degrade to the first edge in priority order, which prefers the top. `tile-roles.test.ts` asserts a wall role comes back for all 256 neighbourhoods, so no level can produce an undrawable cell. Resolving the degraded cases properly needs the 47-piece blob set, which is a much larger art burden for a case Sokoban walls rarely show.

`wall` is in practice the fallback rather than a tile that gets drawn: a cell with nothing open anywhere is culled before classification, exactly as in the game. It stays required because every unbound piece falls back to it.

The classifier lives in `render/` rather than the editor so the preview and the game cannot disagree about which piece a wall gets; `editor/skin/roles.ts` only reads the neighbourhood off a document, treating off-grid as wall so a document's outer edge is not an exposed face.

### Layer order, and what it asks of the art

```

floor → every cell of the board, walls included
wall → over floor
goal → over floor
object → box / boxOnGoal / player, over both

````

Floor is one layer under the whole board rather than a tile that the others replace, so every other tile can be a transparent overlay _or_ an opaque tile of its own without the author having to redraw floor into it. What falls out is the one authoring rule: floor opaque, everything else free to use transparency.

That includes `wall`: a wall piece that leaves its edges transparent — a rounded cap, a bevel, a soft shadow onto the floor — composites over the floor it sits on instead of leaving a hole. The nine wall pieces are the reason this matters, since every one of them is an edge or corner whose outline is the point.

A wall with no floor around it is not drawn at all, exactly as in the game — not even floor — so a skin never supplies art for "outside the level" and the board keeps its silhouette against the page.

### An unbound role draws as flat colour

`preview.ts` falls back to the procedural palette for anything unbound, so the preview is always readable and what is still missing shows as a flat block rather than a hole.

### Zooming grows the canvas, it does not transform it

`computeSheetLayout` takes a zoom that multiplies the fit-to-view scale and reports the canvas size that holds the result. The canvas is sized to that and sits in a scroll container, so panning is the browser's and the pointer handler keeps inverting one scale and origin rather than a second transform on top. Zoom being a multiple of the fit also caps the canvas at the view's size times the zoom, whatever the sheet's dimensions, so a large tileset is no harder on the canvas than a small one.

`computeGridLayout` does the same for the board, so a large level can be worked on close up in either panel — level mode's grid and skin mode's preview each sit in their own scroll container. Three views, one gesture: `editor/zoom.ts` owns the step, the two buttons, ctrl + wheel and the scroll anchoring, and leaves sizing the canvas to whichever painter it belongs to.

What a growing canvas costs is the price of not transforming, and it is paid in area: the content's sides are the view's times the zoom, so its _area_ is the view's times the zoom squared, times the device pixel ratio squared again. Deep enough and that is a buffer Chrome refuses outright — over 2^28 device pixels — having first spent a second of the main thread trying to allocate it, which reads as a hung tab rather than a slow one. Two things keep it in bounds, both in terms of the one budget in `backing-store.ts`: the zoom will not take a step whose content would exceed it, so the ceiling follows the window and the display instead of being a step count guessed up front, and the painters' shared resize clamps the pixel ratio rather than the layout, since at that depth everything lands on whole CSS pixels anyway. That resize is also the one place that knows a backing store is only reassigned when its size actually changes: assigning `width` reallocates and zeroes it, and the hover highlight repaints far too often to pay that.

A zoom is a view setting rather than data: none of the three is stored with the skin or the level, and each resets to fit when the editor is cleared.

### One vocabulary for every sheet, including our own output

`SheetSettings` is `tileWidth`, `tileHeight`, `margin`, `spacing` — enough to slice essentially any tileset. The exported atlas is described with the same four numbers, and the game cuts our output with the identical arithmetic because it is the identical module: `render/sheet.ts`, which both sides import.

Re-slicing drops every binding. A tile index only means something against one grid, so keeping indices that now point at different art would be silently wrong; `clearBindings` is the honest answer. It keeps the tints, for the mirror-image reason — see "Where a tint lives".

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
````

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
- The DOM lives only in `host/index.ts`, `editor/index.ts`, `editor/level-mode.ts`, `editor/skin-mode.ts`, `editor/colors-mode.ts`, `editor/swatches.ts` and `editor/publish.ts`. Everything under `editor/skin/` is pure or draws into a canvas it was handed — `atlas.ts` and `tinted-tiles.ts` create one, which is why `editor/tint.ts` holds the tint vocabulary separately: `document.ts` needs the type and must stay free of the DOM, exactly as it takes `BuiltInLayer` from `render/layers.ts`.
- `localStorage` lives only in `editor/storage.ts`, which holds the keys and swallows the browser's failure modes. What goes in them is `editor/stored-state.ts`, which is pure and tested; the game stores nothing.
- The file system lives only in `tools/level-export-plugin.ts`, which runs in the dev server and never in a browser or a build. It is also the only place a path is built from user input, which is why it derives the slug itself.
- `tools/` may import `src/core/`, and nothing else may import `tools/`.
- `editor/index.ts` is a mode switch and nothing else: it owns which panel is visible, routes keys and resizes to it, and builds the three things no single panel owns — the level autosave, the palette library and the publish panel.
- A skin binds a role; a layer names cells; a colour palette names neither. The first lives in `SkinDraft`, the second on `EditorDocument`, the third in `ColorPaletteLibrary`, and no module holds two of them.
- `editor/swatches.ts` is the one DOM module that is not a panel: it builds a list of colours and reads a click back off it, and knows nothing about what an action means. Both colour panels draw the same row and style it differently, which is the part worth sharing.

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

The editor's pure modules are tested the same way, with XSB as the language in both directions — `parseXsbToDocument` in, `formatDocumentAsXsb` out, so a brush test is two boards. The layers are the exception, because XSB cannot spell them: those assertions read the stack.

`color-palettes.test.ts` leans on the identity contract as much as on the values — `toBe`, not `toEqual`, wherever an edit should have been a no-op, because that is what every panel's "redraw only on a real change" rests on. `hex.test.ts` asserts the widening in both directions, including the two things it must _not_ read: a format the program does not have (`#ffffffaa`) and a function call that is full of hex digits (`rgb(26, 28, 44)`).

`layout.ts`, `canvas.ts` and `zoom.ts` are untested: the first is the arithmetic the pointer handler and the renderer share — a few lines, and `palette-layout.test.ts` covers the same shape for the sheet — the second is drawing, and the third is two buttons and a scroll offset.

`render/skin.test.ts` covers the seam between the editor's output and the game's input: that a manifest resolves to the columns the atlas was packed with, that an unbound wall piece falls back to the wall fill, that an unrecognised role still consumes its column, and that a column past the ones `roles` names still cuts. The atlas it tests against is two numbers, because its size is all a skin reads off the image.

`skin/layers.test.ts` covers the other half of that seam the only way worth doing it: `formatLayersFile` out, `parseLayerStack` — the game's own reader — back in, asserted against the packing. A column that survives the file is the whole promise, and asserting either side against a literal would not make it.

`host/save.test.ts` and `host/level-order.test.ts` cover the rules for a save or an order that has drifted from the levels: a save follows its level through a reorder, falls back to the first unsolved level when its level has gone, and an order file's unknown slugs are skipped and its unlisted levels appended.

`host/levels.ts` and `editor/publish.ts` are untested, and so are the export and order endpoints. They are I/O, and the one thing worth asserting about them — that only a level the game can load is ever written — is asserted by `parseStringToLevelState`, which the endpoint calls and `core/level.test.ts` already covers from both directions.

## Naming

Identifiers are spelled out: `playerMoveDirection` not `dir`, `destination` not `dest`, `context` not `ctx`, `character` not `char`, `position` not `i`.

The only short names left are `x` and `y` for grid coordinates, where the single letters are the convention rather than a contraction.

## Deferred decisions

- `step` returns only the new state, not `{ state, events }`. Animation and sound will need either a diff of consecutive states or an event channel; that choice is postponed until one of them is actually built.
- Level sets. `levels/` holds one level per directory, which is what the editor produces; a downloaded `.sok` collection is many levels in one file. Reading those needs a pure `parseCollection(text)` in `core/level.ts` to split the file and strip its `Title:` / `Author:` metadata, and a second shape in the catalog for "a directory of levels that share a skin". `parseStringToLevelState()` itself would not change. Not built, because nothing in the repository is a collection yet.
- Redo is not wired up. The history stack already supports it; it needs a forward stack and a key.
