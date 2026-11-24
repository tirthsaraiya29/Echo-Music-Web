import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { innertubeRouter } from './routes/innertube.ts'
import { radioRouter } from './routes/radio.ts'
import { sponsorblockRouter } from './routes/sponsorblock.ts'
import { streamRouter } from './routes/stream.ts'
import { canvasRouter } from './routes/canvas.ts'
import { lyricsRouter } from './routes/lyrics.ts'
import { spotifyRouter } from './routes/spotify.ts'
import { listenTogetherRouter } from './routes/listenTogether.ts'
import { recognitionRouter } from './routes/recognition.ts'
import { musicDnaRouter } from './routes/musicDna.ts'
import { lastfmRouter } from './routes/lastfm.ts'
import { discordRouter } from './routes/discord.ts'
import { cloudRouter } from './routes/cloud.ts'
import { extensionsRouter } from './routes/extensions.ts'
import {
  buildHealthPayload,
  getDeploymentMetrics,
  recordDeploymentMetric,
} from './utils/deploymentTypes.ts'
import {
  parseAndValidateAllowedOrigins,
  isOriginAllowed,
  getSecurityHeaders,
  recordCorsMetric,
  getCorsMetrics,
} from './utils/corsTypes.ts'

export const app = new Hono()

// Browsers on the same origin never trigger CORS (same-origin requests are exempt), so the
// allowlist below only has to cover cross-origin deployments.
const allowedOrigins = parseAndValidateAllowedOrigins(process.env['CORS_ORIGINS'])

app.use('*', async (c, next) => {
  recordDeploymentMetric('requestsHandled')
  const secHeaders = getSecurityHeaders()
  for (const [key, value] of Object.entries(secHeaders)) {
    c.header(key, value)
  }
  recordCorsMetric('securityHeadersApplied')
  await next()
})

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return undefined
      return isOriginAllowed(origin, allowedOrigins) ? origin : undefined
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Range', 'Authorization', 'X-YouTube-Visitor-Data'],
    exposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  }),
)

app.onError((err, c) => {
  recordDeploymentMetric('serverErrors')
  // Log full details server-side; never surface raw upstream/internal error
  // messages to clients (they can leak proxy targets, tokens or stack info).
  console.error(`[proxy] ${c.req.method} ${c.req.path} failed:`, err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

app.get('/api/health', (c) => {
  recordDeploymentMetric('healthChecks')
  return c.json(buildHealthPayload('ok'))
})

app.get('/api/deployment/telemetry', (c) => {
  recordDeploymentMetric('telemetryRequests')
  return c.json(getDeploymentMetrics())
})

app.get('/api/cors/telemetry', (c) => {
  return c.json(getCorsMetrics())
})

app.route('/api/innertube', innertubeRouter)
app.route('/api/stream', streamRouter)
app.route('/api/radio', radioRouter)
app.route('/api/sponsorblock', sponsorblockRouter)
app.route('/api/canvas', canvasRouter)
app.route('/api/lyrics', lyricsRouter)
app.route('/api/spotify', spotifyRouter)
app.route('/api/listen-together', listenTogetherRouter)
app.route('/api/recognition', recognitionRouter)
app.route('/api/music-dna', musicDnaRouter)
app.route('/api/lastfm', lastfmRouter)
app.route('/api/discord', discordRouter)
app.route('/api/cloud', cloudRouter)
app.route('/api/extensions', extensionsRouter)

// Production static asset serving & SPA client-side routing fallback
const staticDir = process.env['STATIC_DIR'] || './dist'
if (fs.existsSync(staticDir)) {
  app.use('/*', serveStatic({ root: staticDir }))
  const indexHtmlPath = path.join(staticDir, 'index.html').replace(/\\/g, '/')
  if (fs.existsSync(indexHtmlPath)) {
    app.get('*', serveStatic({ path: indexHtmlPath }))
  }
}

const port = Number.parseInt(process.env['PORT'] || '3000', 10)

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url)
    .toLowerCase()
    .replace(/\\/g, '/') === process.argv[1].toLowerCase().replace(/\\/g, '/')

if (isDirectRun) {
  process.on('uncaughtException', (err) => {
    console.error('Server uncaught exception:', err)
  })

  process.on('unhandledRejection', (reason) => {
    console.error('Server unhandled rejection:', reason)
  })

  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      console.log(`Echo Audio Proxy Server running on port ${info.port}`)
    },
  )
}
