import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/**
 * The live link from the theme colour picker, server side. The picker runs on
 * its own origin, so nothing in the browser can reach the editor directly: it
 * posts the set it has open here, and the dev server hands it to every editor
 * page over the HMR socket the page already holds.
 *
 * The last set is kept, so an editor opened (or reloaded) after the picker
 * last changed still has something to follow — it asks with a GET. Nothing is
 * written to disk: the link carries colours, and what the editor does with them
 * goes through its own autosave like any other edit.
 *
 * Dev only, like the export endpoint — it is a bridge between two local tools.
 */
const ENDPOINT = '/api/live-colors'

/** What the editor listens for on `import.meta.hot`. */
const EVENT = 'live-colors'

/** A set is a few dozen names; this is just a guard. */
const MAX_BODY_BYTES = 64 * 1024

type LiveColors = {
  readonly palette: string
  readonly set: string
  readonly colors: Readonly<Record<string, string>>
}

export function liveColorsPlugin(): Plugin {
  return {
    name: 'sokoban:live-colors',
    apply: 'serve',
    configureServer(server) {
      let last: LiveColors | null = null

      server.middlewares.use(ENDPOINT, (request, response) => {
        // The picker is another origin, and a JSON body makes its POST a
        // non-simple request, so the preflight has to be answered too.
        response.setHeader('access-control-allow-origin', '*')
        response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
        response.setHeader('access-control-allow-headers', 'content-type')

        if (request.method === 'OPTIONS') {
          response.statusCode = 204
          response.end()

          return
        }

        if (request.method === 'GET') {
          send(response, 200, last)

          return
        }

        if (request.method !== 'POST') {
          send(response, 405, { message: `${ENDPOINT} takes a GET or a POST.` })

          return
        }

        readBody(request)
          .then((body) => {
            const payload = parsePayload(body)

            if (typeof payload === 'string') {
              send(response, 400, { message: payload })

              return
            }

            last = payload
            server.ws.send({ type: 'custom', event: EVENT, data: payload })
            send(response, 200, { clients: server.ws.clients.size })
          })
          .catch((error: unknown) => {
            send(response, 500, {
              message: error instanceof Error ? error.message : String(error),
            })
          })
      })
    },
  }
}

/**
 * Only the shape is checked here. Whether a key names a role and a value is a
 * hex is the editor's to judge, because it is the editor that reports what it
 * skipped — the same reader the paste dialog uses.
 */
function parsePayload(body: string): LiveColors | string {
  let parsed: unknown

  try {
    parsed = JSON.parse(body)
  } catch {
    return 'The live colours were not JSON.'
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return 'The live colours were not an object.'
  }

  const record = parsed as Record<string, unknown>
  const colors = record.colors

  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
    return 'The live colours need a colors object.'
  }

  const entries = Object.entries(colors as Record<string, unknown>)

  if (entries.some(([, value]) => typeof value !== 'string')) {
    return 'Every live colour has to be a string.'
  }

  return {
    palette: typeof record.palette === 'string' ? record.palette : '',
    set: typeof record.set === 'string' ? record.set : '',
    colors: Object.fromEntries(entries) as Record<string, string>,
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
        reject(new Error('The live colours were too large to accept.'))

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
  payload: unknown,
): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(payload))
}
