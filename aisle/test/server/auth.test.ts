import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app'
import { loadConfig } from '../../src/server/env'
import type { Me } from '../../src/shared/types'
import { Client, setup } from './helpers'

describe('accounts', () => {
  it('signs up into a new household and keeps the session in an HttpOnly cookie', async () => {
    const { app } = setup()
    const ana = new Client(app)
    const res = await ana.request('POST', '/api/auth/signup', {
      name: 'Ana Lima',
      email: 'Ana@Example.com ',
      password: 'correct horse battery',
    })
    expect(res.status).toBe(201)
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toMatch(/^aisle_session=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).not.toMatch(/Secure/)
    const me = (await res.json()) as Me
    expect(me.user).toMatchObject({ name: 'Ana Lima', email: 'ana@example.com' })
    expect(me.household.name).toBe("Ana's household")
    expect(me.household.inviteCode).toMatch(/^[A-Z2-9]{8}$/)
    expect(await ana.json<Me>('GET', '/api/me')).toEqual(me)
  })

  it('marks the cookie Secure when configured for HTTPS', async () => {
    const { app } = setup({ env: { COOKIE_SECURE: 'true' } })
    const res = await new Client(app).request('POST', '/api/auth/signup', {
      name: 'Ana',
      email: 'ana@example.com',
      password: 'correct horse battery',
    })
    expect(res.headers.get('set-cookie')).toMatch(/Secure/)
    expect(res.headers.get('strict-transport-security')).toBe('max-age=15552000')
  })

  it('rejects a second account with the same email in any case', async () => {
    const { app } = setup()
    await new Client(app).signup('Ana', 'ana@example.com')
    const res = await new Client(app).request('POST', '/api/auth/signup', {
      name: 'Imposter',
      email: 'ANA@example.com',
      password: 'another password',
    })
    expect(res.status).toBe(409)
  })

  it('explains validation problems', async () => {
    const { app } = setup()
    const res = await new Client(app).request('POST', '/api/auth/signup', {
      name: 'Ana',
      email: 'not-an-email',
      password: 'short',
    })
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('Enter a valid email address')
    expect(error).toContain('Use at least 8 characters')
  })

  it('logs in, logs out, and rejects wrong passwords', async () => {
    const { app } = setup()
    await new Client(app).signup('Ana', 'ana@example.com')
    const device = new Client(app)
    expect((await device.request('POST', '/api/auth/login', { email: 'ana@example.com', password: 'wrong password' })).status).toBe(401)
    expect((await device.request('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'whatever!' })).status).toBe(401)
    const me = await device.json<Me>('POST', '/api/auth/login', { email: 'ANA@example.com', password: 'correct horse battery' })
    expect(me.user.email).toBe('ana@example.com')
    expect((await device.request('GET', '/api/me')).status).toBe(200)
    const sessionCookie = device.cookie
    expect((await device.request('POST', '/api/auth/logout')).status).toBe(204)
    expect(device.cookie).toBe('')
    expect((await device.request('GET', '/api/me')).status).toBe(401)
    // The old token is dead on the server too, not just forgotten by the browser.
    device.cookie = sessionCookie
    expect((await device.request('GET', '/api/me')).status).toBe(401)
  })

  it('rate limits repeated failed logins', async () => {
    const { app } = setup()
    await new Client(app).signup('Ana', 'ana@example.com')
    const attacker = new Client(app)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await attacker.request('POST', '/api/auth/login', { email: 'ana@example.com', password: `guess ${i}` })).status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('expires sessions and slides them forward while in use', async () => {
    const { app, clock } = setup()
    const ana = new Client(app)
    await ana.signup('Ana', 'ana@example.com')
    clock.advance(40 * 86_400_000)
    const res = await ana.request('GET', '/api/me')
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=5184000/)
    clock.advance(59 * 86_400_000)
    expect((await ana.request('GET', '/api/me')).status).toBe(200)
    clock.advance(61 * 86_400_000)
    expect((await ana.request('GET', '/api/me')).status).toBe(401)
  })

  it('changes the password and signs out other devices', async () => {
    const { app } = setup()
    const phone = new Client(app)
    await phone.signup('Ana', 'ana@example.com')
    const laptop = new Client(app)
    await laptop.json('POST', '/api/auth/login', { email: 'ana@example.com', password: 'correct horse battery' })
    const wrong = await phone.request('POST', '/api/me/password', { currentPassword: 'nope', newPassword: 'a brand new password' })
    expect(wrong.status).toBe(403)
    await phone.json('POST', '/api/me/password', { currentPassword: 'correct horse battery', newPassword: 'a brand new password' })
    expect((await phone.request('GET', '/api/me')).status).toBe(200)
    expect((await laptop.request('GET', '/api/me')).status).toBe(401)
    const login = await new Client(app).request('POST', '/api/auth/login', { email: 'ana@example.com', password: 'a brand new password' })
    expect(login.status).toBe(200)
  })

  it('requires the X-Aisle header on state-changing requests', async () => {
    const { app } = setup()
    const res = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ana', email: 'ana@example.com', password: 'correct horse battery' }),
    })
    expect(res.status).toBe(403)
  })

  it('requires a session for household data', async () => {
    const { app } = setup()
    expect((await app.request('/api/sync')).status).toBe(401)
    expect((await app.request('/api/me')).status).toBe(401)
    expect((await app.request('/api/config')).status).toBe(200)
  })

  it('answers unknown API routes with JSON 404s and sets security headers', async () => {
    const { app } = setup()
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('reports which capture engines are available', async () => {
    const { app } = setup({ env: { AI_API_KEY: 'sk-test', AI_TRANSCRIBE_MODEL: '' } })
    const config = await (await app.request('/api/config')).json()
    expect(config).toEqual({
      features: { ai: true, aiModel: 'gpt-4.1-mini', transcription: false, ocr: true },
      signupMode: 'open',
    })
  })

  it('in invite mode, only allows sign-ups that join an existing household', async () => {
    const { app, db } = setup()
    const me = await new Client(app).signup('Ana', 'ana@example.com')
    const inviteOnly = createApp({ db, config: loadConfig({ SIGNUP_MODE: 'invite' }) })
    const stranger = await new Client(inviteOnly).request('POST', '/api/auth/signup', {
      name: 'Stranger',
      email: 'stranger@example.com',
      password: 'correct horse battery',
    })
    expect(stranger.status).toBe(403)
    const ben = await new Client(inviteOnly).signup('Ben', 'ben@example.com', { inviteCode: me.household.inviteCode.toLowerCase() })
    expect(ben.household.id).toBe(me.household.id)
    expect(ben.household.members.map((m) => m.name)).toEqual(['Ana', 'Ben'])
  })
})
