/**
 * cookie-auth saf yardımcı testleri — refresh cookie adı + okuma/doğrulama.
 */
import './setup-env';
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { refreshCookieName, getRefreshCookie } from '../src/middleware/cookie-auth';

describe('refreshCookieName', () => {
  it('her kind için ayrı cookie adı döner', () => {
    const names = (['user', 'admin', 'danisman', 'arge'] as const).map(refreshCookieName);
    expect(new Set(names).size).toBe(4); // hepsi benzersiz
    expect(refreshCookieName('user')).toContain('user');
    expect(refreshCookieName('admin')).toContain('admin');
  });
});

describe('getRefreshCookie', () => {
  const mkReq = (cookies: Record<string, string>) => ({ cookies }) as unknown as Request;

  it('geçerli (>=20 char) cookie değerini döner', () => {
    const name = refreshCookieName('user');
    const token = 'a'.repeat(48);
    expect(getRefreshCookie(mkReq({ [name]: token }), 'user')).toBe(token);
  });

  it('çok kısa değeri reddeder (null)', () => {
    const name = refreshCookieName('user');
    expect(getRefreshCookie(mkReq({ [name]: 'short' }), 'user')).toBeNull();
  });

  it('cookie yoksa null döner', () => {
    expect(getRefreshCookie(mkReq({}), 'user')).toBeNull();
  });

  it('yanlış kind cookie\'sini okumaz', () => {
    const adminName = refreshCookieName('admin');
    const token = 'b'.repeat(48);
    expect(getRefreshCookie(mkReq({ [adminName]: token }), 'user')).toBeNull();
  });
});
