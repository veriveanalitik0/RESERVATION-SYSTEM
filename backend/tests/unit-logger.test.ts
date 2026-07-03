/**
 * Logger birim testleri — saf (DB gerektirmez).
 *
 *  - maskEmail: PII maskeleme.
 *  - scrub formatı: hassas alanları [REDACTED] yapar VE log satırını yutmaz
 *    (winston Symbol(level)/Symbol(message) korunmalı — geçmişteki "tüm loglar
 *    sessizce kayboluyordu" regresyonunu kilitler).
 */
import './setup-env';
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import winston from 'winston';
import { logger, maskEmail } from '../src/utils/logger';

describe('maskEmail', () => {
  it('normal e-postayı maskeler (ilk harf + domain)', () => {
    expect(maskEmail('ayse.yilmaz@klab.test')).toBe('a***@klab.test');
  });
  it('tek karakterli local kısmı tamamen maskeler', () => {
    expect(maskEmail('a@b.com')).toBe('*@b.com');
  });
  it('geçersiz e-postayı işaretler', () => {
    expect(maskEmail('gecersiz')).toBe('[INVALID_EMAIL]');
  });
});

describe('logger scrub formatı (symbol-koruma regresyonu)', () => {
  it('hassas alanı REDACT eder, log satırını YUTMAZ, normal alanı korur', async () => {
    const captured: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) { captured.push(chunk.toString()); cb(); },
    });
    const transport = new winston.transports.Stream({ stream });
    logger.add(transport);
    logger.info('test_event', { password: 'cokGizli123', email: 'a@b.com', durum: 'tamam' });
    // winston transport yazımının tamamlanması için bir tick bekle
    await new Promise((r) => setImmediate(r));
    logger.remove(transport);

    const out = captured.join('');
    expect(out).toContain('test_event');      // mesaj korundu → symbol fix çalışıyor
    expect(out).toContain('[REDACTED]');       // password maskelendi
    expect(out).not.toContain('cokGizli123');  // hassas değer sızmadı
    expect(out).toContain('tamam');            // normal alan kaldı
  });
});
