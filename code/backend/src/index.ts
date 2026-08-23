import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './auth'

const app = new Hono()

app.use(
  '/api/auth/**',
  cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
  }),
)

app.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default {
  port: 8787,
  fetch: app.fetch,
}
