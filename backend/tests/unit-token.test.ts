/**
 * Token servisi birim testleri — RS256 imza/doğrulama (DB gerektirmez, key dosyası
 * gerektirir). Güvenlik sözleşmesi: kind izolasyonu + tahrifat reddi.
 */
import './setup-env';
import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../src/services/token.service';

const payload = { sub: 'user-123', role: 'user', email: 'u@klab.test' };

describe('signAccessToken / verifyAccessToken', () => {
  it('imzalanan token aynı kind ile doğrulanır (roundtrip)', () => {
    const { token, ttl } = signAccessToken('user', payload);
    expect(ttl).toBeGreaterThan(0);
    const decoded = verifyAccessToken('user', token);
    expect(decoded.sub).toBe('user-123');
    expect(decoded.email).toBe('u@klab.test');
    expect(decoded.type).toBe('user');
  });

  it('user token admin olarak doğrulanamaz (audience/kind izolasyonu)', () => {
    const { token } = signAccessToken('user', payload);
    expect(() => verifyAccessToken('admin', token)).toThrow();
  });

  it('admin token user olarak doğrulanamaz', () => {
    const { token } = signAccessToken('admin', { sub: 'a1', role: 'admin', email: 'a@klab.test' });
    expect(() => verifyAccessToken('user', token)).toThrow();
  });

  it('tahrif edilmiş token reddedilir', () => {
    const { token } = signAccessToken('user', payload);
    const tampered = token.slice(0, -3) + 'xyz';
    expect(() => verifyAccessToken('user', tampered)).toThrow();
  });

  it('rastgele/boş string reddedilir', () => {
    expect(() => verifyAccessToken('user', 'not-a-jwt')).toThrow();
  });
});
