/**
 * Zod doğrulayıcı birim testleri — saf (DB gerektirmez).
 * Girdi whitelist'inin (e-posta formatı, parola karmaşıklığı) sözleşmesini kilitler.
 */
import './setup-env';
import { describe, it, expect } from 'vitest';
import { emailSchema, passwordSchema, loginSchema } from '../src/validators/schemas';

describe('emailSchema', () => {
  it('geçerli e-postayı kabul eder ve normalize eder (trim + lowercase)', () => {
    expect(emailSchema.parse('  Ayse.Yilmaz@Klab.Test ')).toBe('ayse.yilmaz@klab.test');
  });
  it('geçersiz formatı reddeder', () => {
    expect(() => emailSchema.parse('gecersiz')).toThrow();
  });
  it('çok kısa/boş e-postayı reddeder', () => {
    expect(() => emailSchema.parse('a@b')).toThrow();
  });
});

describe('passwordSchema', () => {
  it('güçlü parolayı kabul eder', () => {
    expect(() => passwordSchema.parse('Guclu1Parola!')).not.toThrow();
  });
  it('12 karakterden kısa parolayı reddeder', () => {
    expect(() => passwordSchema.parse('Kisa1!')).toThrow();
  });
  it('büyük harf yoksa reddeder', () => {
    expect(() => passwordSchema.parse('kucukharf1!ab')).toThrow();
  });
  it('rakam yoksa reddeder', () => {
    expect(() => passwordSchema.parse('BuyukKucuk!ab')).toThrow();
  });
  it('özel karakter yoksa reddeder', () => {
    expect(() => passwordSchema.parse('BuyukKucuk1abc')).toThrow();
  });
});

describe('loginSchema', () => {
  it('e-posta + parola ile geçerli', () => {
    const r = loginSchema.parse({ email: 'USER@klab.test', password: 'x' });
    expect(r.email).toBe('user@klab.test');
    expect(r.password).toBe('x');
  });
  it('eksik alanı reddeder', () => {
    expect(() => loginSchema.parse({ email: 'user@klab.test' })).toThrow();
  });
});
