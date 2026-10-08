# Architecture

Three modules. The game logic is a pure state transition function; everything else is a thin shell around it.

```
index.html
src/core/      types.ts, level.ts, step.ts, rules.ts    pure, no DOM, no I/O
src/host/      index.ts, level-data.ts                  history stack, keybindings, dispatch
src/render/    canvas.ts                                (state) => draw
```

TypeScript, built with Vite. `npm run dev` to play, `npm run typecheck` to check.

## `core/` — pure, no DOM, no I/O

| File | Exports |
| --- | --- |
| `types.ts` | `PlayerMoveDirection`, `Level`, `LevelState` |
| `level.ts` | `parse(xsb: string)` → `Level` plus the initial `LevelState` |
| `step.ts` | `step(levelState: LevelState, playerMoveDirection: PlayerMoveDirection): LevelState` — returns the same state for illegal moves |
| `rules.ts` | `isSolved(levelState)`, `getNextPosition(level, position, playerMoveDirection)` |

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

Real level text is ragged: short lines, leading spaces that are outside the puzzle, and wall segments with empty space behind them. Rather than requiring or synthesising an outer border, `parse()` flood-fills from the player across non-wall characters and marks everything it cannot reach as a wall.

That makes the playfield self-enclosing by construction, collapses the "outside the level" and "wall" cases into one flag, and catches malformed levels — a box or goal sealed off from the player is a parse error rather than an unwinnable game.

### Level format

Levels are parsed from standard XSB text, so existing level sets work without conversion.

| Character | Meaning |
| --- | --- |
| `#` | wall |
| `$` | box |
| `.` | goal |
| `@` | player |
| `*` | box on goal |
| `+` | player on goal |
| space | floor |

## `host/` — the only mutable thing in the system

Owns a `LevelState[]` history stack — the only mutable value in the program. Maps keys to a command, calls `step`, pushes the result, and handles undo by popping and reset by truncating to the first entry. Calls the renderer after each change. No game rules live here.

Undo is deliberately outside engine state. Because `step` is pure, keeping a stack of previous states gives undo, redo, and replay for free, and the engine stays simple.

Illegal moves are detected by identity: `step` returns the same object when nothing changed, so `next === current()` means the move was rejected and no history entry is recorded.

Keys: arrows or WASD to move, Z or U to undo, R to reset.

## `render/` — dumb

`createRenderer(canvas)` returns a `render(levelState): void` that redraws the whole board. Reads `level.wallMap` and `level.goalPositions` for the board, and `playerCurrentPosition` and `boxPositions` for the movable pieces. No event listeners, no game logic, no knowledge of history.

Full redraw every time is deliberate: it keeps the renderer a pure function of state with nothing to invalidate, and a Sokoban board is small enough that the cost is irrelevant.

## Boundaries that matter

- Rules live only in `core/`. `step` is the single place state changes.
- Input mapping lives only in `host/`. `core/` never sees a keycode — it takes a `PlayerMoveDirection`.
- Undo lives only in `host/`, outside engine state.
- `core/` imports nothing from `host/` or `render/`, so it runs unchanged in Node tests, a terminal front end, or a solver.

## Naming

Identifiers are spelled out: `playerMoveDirection` not `dir`, `destination` not `dest`, `context` not `ctx`, `character` not `char`, `position` not `i`.

The only short names left are `x` and `y` for grid coordinates, where the single letters are the convention rather than a contraction.

## Deferred decisions

- `step` returns only the new state, not `{ state, events }`. Animation and sound will need either a diff of consecutive states or an event channel; that choice is postponed until one of them is actually built.
- The level is a hardcoded string in `host/level-data.ts`, to avoid an async loading path before there is anything to look at. When real level sets arrive they go in `levels/*.sok` as plain text, the host fetches them, and `core/level.ts` gains a pure `parseCollection(text)` to split a multi-level file and strip its `Title:` / `Author:` metadata. `parse()` itself does not change.
- Redo is not wired up. The history stack already supports it; it needs a forward stack and a key.
