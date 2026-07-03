/**
 * Route katmanı yardımcıları.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { HttpError } from '../middleware/error.middleware';

/**
 * Async route handler sarıcısı: handler'dan dönen promise reject olursa hatayı
 * merkezi error middleware'e iletir (next). Her handler'a try/catch + next(err)
 * yazma tekrarını ortadan kaldırır ve kaçan promise'i (no-floating-promises)
 * yapısal olarak engeller. Yeni endpoint'lerde tercih edin.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Route path parametresinden id okur ve whitelist doğrulaması yapar (8-40 karakter).
 * Tüm route'larda birebir tekrarlanan inline id kontrolünün tek kaynağı; sınır
 * mantığı tek yerde değişir.
 *
 * @param param  Okunacak path parametresinin adı (varsayılan 'id').
 * @param label  Hata mesajındaki etiket (örn. 'booking id', 'kişi id').
 */
export function readId(req: Request, param = 'id', label = 'id'): string {
  const raw = req.params[param];
  const id = typeof raw === 'string' ? raw : '';
  if (!id || id.length < 8 || id.length > 40) {
    throw new HttpError(400, `Geçersiz ${label}.`, 'INVALID_ID');
  }
  return id;
}
