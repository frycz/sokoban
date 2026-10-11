import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { parseStringToLevelState } from '../src/core/level'

/**
 * The editor's Export to levels/ button, server side. A browser cannot write to
 * the repository, so the dev server does it: one endpoint, one directory per
 * level, and the game's globs pick the result up on its next load.
 *
 * It also reads them back, for the editor's Open level picker: a GET lists the
 * bundles, and a GET with a slug hands one over in the shape the export posts,
 * so a level can be opened, changed and exported over itself. Through the dev
 * server rather than the editor's own globs, because a glob over `levels/`
 * would reload the editor every time it exported.
 *
 * Dev only, deliberately — the editor is an internal tool and this writes to
 * the working tree. Nothing about it reaches a built bundle.
 */
const ENDPOINT = '/api/levels'
const LEVELS_DIRECTORY = 'levels'

/** An atlas for a fourteen-role skin is a few kilobytes; this is just a guard. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

const ATLAS_PREFIX = 'data:image/png;base64,'

/** Written by the endpoint, so a bundle it replaces never keeps stale tiles. */
const SKIN_FILES = ['skin.json', 'skin.png', 'tiles.json'] as const

type SkinPayload = {
  readonly manifest: string
  readonly atlasDataUrl: string
  /** `tiles.json`, or null when the level draws in the default order. */
  readonly layers: string | null
}

export function levelExportPlugin(): Plugin {
  return {
    name: 'sokoban:level-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (request, response) => {
        handle(request, response, server.config.root).catch(
          (error: unknown) => {
            send(response, 500, {
              message: error instanceof Error ? error.message : String(error),
            })
          },
        )
      })
    },
  }
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
): Promise<void> {
  if (request.method === 'GET') {
    await handleRead(request.url ?? '/', response, root)

    return
  }

  if (request.method !== 'POST') {
    send(response, 405, { message: `${ENDPOINT} takes a GET or a POST.` })

    return
  }

  const payload = parsePayload(await readBody(request))

  if (typeof payload === 'string') {
    send(response, 400, { message: payload })

    return
  }

  // The gate the editor's Export button promises: the game's own parser, so
  // nothing lands in `levels/` that the game would then refuse to load. The
  // editor checks the same thing, but the endpoint is what makes it true.
  try {
    parseStringToLevelState(payload.xsb)
  } catch (error) {
    send(response, 400, {
      message: `Not a loadable level: ${error instanceof Error ? error.message : String(error)}`,
    })

    return
  }

  const directory = join(root, LEVELS_DIRECTORY, payload.slug)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'level.xsb'), `${payload.xsb}\n`, 'utf8')
  await writeFile(
    join(directory, 'level.json'),
    // The ground colour only when there is one, so a level with no ground
    // writes exactly the file it always did and the field's absence keeps
    // meaning what it means everywhere else: drawn onto nothing.
    `${JSON.stringify(
      payload.groundColor === null
        ? { name: payload.name }
        : { name: payload.name, groundColor: payload.groundColor },
      null,
      2,
    )}\n`,
    'utf8',
  )

  if (payload.skin) {
    await writeFile(join(directory, 'skin.json'), payload.skin.manifest, 'utf8')
    await writeFile(
      join(directory, 'skin.png'),
      Buffer.from(
        payload.skin.atlasDataUrl.slice(ATLAS_PREFIX.length),
        'base64',
      ),
    )

    // Only the levels that have one, so a bundle is never left with a tiles.json
    // whose columns the new atlas no longer has.
    if (payload.skin.layers) {
      await writeFile(
        join(directory, 'tiles.json'),
        payload.skin.layers,
        'utf8',
      )
    } else {
      await rm(join(directory, 'tiles.json'), { force: true })
    }
  } else {
    // Re-exporting without tiles has to leave the bundle consistent rather than
    // pairing the new level with whatever art happened to be there before.
    for (const file of SKIN_FILES) {
      await rm(join(directory, file), { force: true })
    }
  }

  send(response, 200, {
    slug: payload.slug,
    directory: `${LEVELS_DIRECTORY}/${payload.slug}/`,
  })
}

type ExportRequest = {
  readonly name: string
  readonly slug: string
  readonly xsb: string
  readonly groundColor: string | null
  readonly skin: SkinPayload | null
}

/**
 * Checked here rather than taken on trust, for the reason the slug is derived
 * here: this is what writes the file, and a colour the game's own reader would
 * throw away is one the bundle should never have held. Spelled out rather than
 * imported, because `tools/` may import `core/` and nothing else.
 */
const GROUND_COLOR_PATTERN = /^#[0-9a-f]{6}$/

/** Returns the request, or the message to refuse it with. */
function parsePayload(body: string): ExportRequest | string {
  let parsed: unknown

  try {
    parsed = JSON.parse(body)
  } catch {
    return 'The export request was not JSON.'
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return 'The export request was not an object.'
  }

  const record = parsed as Record<string, unknown>

  if (typeof record.name !== 'string' || typeof record.xsb !== 'string') {
    return 'The export request needs a name and a level.'
  }

  // A level opened from `levels/` goes back to the directory it came from, which
  // its name need not slug to — `Original 1` lives in `original-01/`. Checked
  // against the same shape `toSlug` produces, so it cannot reach outside either.
  if (record.slug !== undefined && !isSlug(record.slug)) {
    return 'The export request named a directory that is not a level slug.'
  }

  const slug = isSlug(record.slug) ? record.slug : toSlug(record.name)

  if (slug === '') {
    return `"${record.name}" has no letters or digits to make a directory name from.`
  }

  const skin = parseSkin(record.skin)

  if (typeof skin === 'string') {
    return skin
  }

  const ground = parseGroundColor(record.groundColor)

  if (typeof ground === 'string') {
    return ground
  }

  return {
    name: record.name.trim(),
    slug,
    xsb: record.xsb,
    groundColor: ground.color,
    skin,
  }
}

/**
 * The ground, or the message to refuse the export with. Wrapped rather than
 * returned bare, because a colour is a string and so is a refusal.
 */
function parseGroundColor(
  value: unknown,
): { readonly color: string | null } | string {
  if (value === null || value === undefined) {
    return { color: null }
  }

  if (typeof value !== 'string' || !GROUND_COLOR_PATTERN.test(value)) {
    return 'The ground colour was not a #rrggbb colour.'
  }

  return { color: value }
}

function parseSkin(value: unknown): SkinPayload | null | string {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'object') {
    return 'The tiles were not an object.'
  }

  const record = value as Record<string, unknown>

  if (
    typeof record.manifest !== 'string' ||
    typeof record.atlasDataUrl !== 'string'
  ) {
    return 'The tiles need a manifest and an atlas.'
  }

  if (!record.atlasDataUrl.startsWith(ATLAS_PREFIX)) {
    return 'The atlas was not a PNG data url.'
  }

  try {
    JSON.parse(record.manifest)
  } catch {
    return 'The skin manifest was not JSON.'
  }

  if (record.layers !== null && record.layers !== undefined) {
    if (typeof record.layers !== 'string') {
      return 'The layers were not a file.'
    }

    try {
      JSON.parse(record.layers)
    } catch {
      return 'The layers were not JSON.'
    }
  }

  return {
    manifest: record.manifest,
    atlasDataUrl: record.atlasDataUrl,
    layers: typeof record.layers === 'string' ? record.layers : null,
  }
}

/**
 * The level's name is what someone typed; the directory is derived from it, and
 * the derivation is here rather than in the browser so the one thing that can
 * name a path is the one that writes to it. The shape is also the check: only
 * lowercase, digits and single hyphens, so no name can reach outside `levels/`.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value)
}

/**
 * `/` lists every bundle, `/<slug>` returns one. The middleware is mounted on
 * the endpoint, so the url here is what follows it.
 */
async function handleRead(
  url: string,
  response: ServerResponse,
  root: string,
): Promise<void> {
  const path = url.split('?')[0].replace(/^\/+|\/+$/g, '')
  const levelsDirectory = join(root, LEVELS_DIRECTORY)

  if (path === '') {
    send(response, 200, { levels: await listLevels(levelsDirectory) })

    return
  }

  if (!isSlug(path)) {
    send(response, 400, { message: `"${url}" is not a level slug.` })

    return
  }

  const bundle = await readBundle(join(levelsDirectory, path))

  if (!bundle) {
    send(response, 404, { message: `There is no level in levels/${path}/.` })

    return
  }

  send(response, 200, { slug: path, ...bundle })
}

/**
 * Every directory with a `level.xsb`, in campaign order and then the rest by
 * slug — the order the author already thinks of them in.
 */
async function listLevels(
  levelsDirectory: string,
): Promise<{ readonly slug: string; readonly name: string }[]> {
  const entries = await readdir(levelsDirectory, { withFileTypes: true })
  const levels: { slug: string; name: string }[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !isSlug(entry.name)) {
      continue
    }

    const directory = join(levelsDirectory, entry.name)

    if ((await readOptionalFile(join(directory, 'level.xsb'))) === null) {
      continue
    }

    const record = readJsonRecord(
      await readOptionalFile(join(directory, 'level.json')),
    )

    levels.push({
      slug: entry.name,
      name: typeof record?.name === 'string' ? record.name : entry.name,
    })
  }

  const order = await readOptionalFile(join(levelsDirectory, 'order.json'))
  let ordered: unknown = []

  try {
    ordered = order === null ? [] : JSON.parse(order)
  } catch {
    // A broken order file only costs the ordering.
  }

  const rank = (slug: string): number => {
    const index = Array.isArray(ordered) ? ordered.indexOf(slug) : -1

    return index < 0 ? Number.POSITIVE_INFINITY : index
  }

  return levels.sort(
    (one, other) =>
      rank(one.slug) - rank(other.slug) || one.slug.localeCompare(other.slug),
  )
}

/**
 * One bundle in the export's own shape. Nothing is judged here — the editor
 * reads every part leniently, as the game does — so a half-broken bundle still
 * opens as far as it can.
 */
async function readBundle(directory: string): Promise<{
  readonly name: string
  readonly xsb: string
  readonly groundColor: string | null
  readonly skin: SkinPayload | null
} | null> {
  const xsb = await readOptionalFile(join(directory, 'level.xsb'))

  if (xsb === null) {
    return null
  }

  const record = readJsonRecord(
    await readOptionalFile(join(directory, 'level.json')),
  )
  const manifest = await readOptionalFile(join(directory, 'skin.json'))
  const atlas = await readOptionalBytes(join(directory, 'skin.png'))

  return {
    name:
      typeof record?.name === 'string'
        ? record.name
        : (directory.split('/').pop() ?? ''),
    xsb,
    groundColor:
      typeof record?.groundColor === 'string' &&
      GROUND_COLOR_PATTERN.test(record.groundColor)
        ? record.groundColor
        : null,
    skin:
      manifest === null || atlas === null
        ? null
        : {
            manifest,
            atlasDataUrl: `${ATLAS_PREFIX}${atlas.toString('base64')}`,
            layers: await readOptionalFile(join(directory, 'tiles.json')),
          },
  }
}

function readJsonRecord(text: string | null): Record<string, unknown> | null {
  if (text === null) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(text)

    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

async function readOptionalFile(path: string): Promise<string | null> {
  const bytes = await readOptionalBytes(path)

  return bytes === null ? null : bytes.toString('utf8')
}

async function readOptionalBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length

      if (size > MAX_BODY_BYTES) {
        request.destroy()
        reject(new Error('The export was too large to accept.'))

        return
      }

      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function send(
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(payload))
}
