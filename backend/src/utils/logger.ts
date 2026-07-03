/**
 * Structured logger with PII/secret scrubbing.
 * data_security.md §4: Sensitive field'lar log'a yazılmaz, [REDACTED] ile değiştirilir.
 */
import winston from 'winston';
import { config } from '../config/env';

const SENSITIVE_KEYS = [
  'password',
  'pwd',
  'secret',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'tckn',
  'iban',
  'cardnumber',
  'cardno',
  'pan',
  'cvv',
  'cvc',
  'ssn',
  'creditcard',
  'refresh_token',
  'access_token',
  'private_key',
  'privatekey',
  'cookie',
];

function sanitizeKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

function scrubLogInjection(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').replace(/\[[0-9;]*[a-zA-Z]/g, '');
}

function scrub(obj: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return scrubLogInjection(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrub(v, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = sanitizeKey(key) ? '[REDACTED]' : scrub(value, depth + 1);
  }
  return result;
}

// info'nun kimliğini KORU: winston, log seviyesini/mesajını `info` üzerindeki
// Symbol(level)/Symbol(message) anahtarlarında tutar. Yeni bir düz nesne döndürmek
// (Object.entries Symbol'leri kopyalamaz) bu Symbol'leri düşürür ve transport TÜM
// log satırlarını sessizce yutar. Bu yüzden yalnızca string-anahtarlı alanları
// yerinde temizleyip aynı `info` referansını döndürüyoruz.
const scrubFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    info[key] = sanitizeKey(key) ? '[REDACTED]' : scrub(info[key]);
  }
  return info;
})();

export const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    scrubFormat,
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: config.isProduction
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf((info) => {
              const { timestamp, level, message, ...rest } = info;
              const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
              return `${timestamp} [${level}] ${message}${meta}`;
            })
          ),
    }),
  ],
});

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '[INVALID_EMAIL]';
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}
