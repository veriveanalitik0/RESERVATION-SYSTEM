/**
 * Centralised error handler.
 * app_security.md §8: Stack trace, SQL, IP veya iç sistem bilgisi kullanıcıya gösterilmez.
 */
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string,
    public readonly code?: string,
    public readonly detail?: Record<string, unknown>
  ) {
    super(publicMessage);
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Kaynak bulunamadı.' });
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    logger.warn('http_error', {
      status: err.status,
      code: err.code,
      path: req.path,
    });
    res.status(err.status).json({
      error: err.publicMessage,
      ...(err.code ? { code: err.code } : {}),
      ...(err.detail ? { detail: err.detail } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    logger.warn('validation_error', { path: req.path, issues });
    res.status(400).json({ error: 'Girdi doğrulama hatası.', issues });
    return;
  }

  // Body-parser (express.json) hataları — generic 500 yerine doğru 4xx.
  // app_security §8: istemci hatası 5xx olarak loglanıp yanlış alarm üretmemeli.
  const be = err as Error & { status?: number; statusCode?: number; type?: string };
  if (be.type === 'entity.too.large') {
    logger.warn('payload_too_large', { path: req.path });
    res.status(413).json({ error: 'İstek gövdesi çok büyük.' });
    return;
  }
  if (be.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    logger.warn('malformed_json', { path: req.path });
    res.status(400).json({ error: 'Geçersiz JSON gövdesi.' });
    return;
  }

  logger.error('unhandled_error', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    path: req.path,
  });
  res.status(500).json({ error: 'İşlem başarısız.' });
}
