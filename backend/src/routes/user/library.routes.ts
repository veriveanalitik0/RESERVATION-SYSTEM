/**
 * Kullanıcı kütüphane rotaları: /books (ödünç alma) + /loans (iade, uzatma, iptal).
 * user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  borrowBookSchema,
  requestExtensionSchema,
} from '../../validators/schemas';
import {
  listAvailableBooks,
  borrowBook,
  listMyLoans,
  returnBook,
  requestExtension,
  cancelPendingLoan,
} from '../../services/book.service';
import { readId } from '../../utils/route-helpers';

const router = Router();

/* ============ KÜTÜPHANE (kitap ödünç alma/iade) ============ */

// Ödünç alınabilir (aktif) kitaplar + bu kullanıcının halen ödüncte tuttukları (borrowedByMe).
router.get('/books', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ books: await listAvailableBooks(req.auth!.subjectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/books/:id/borrow', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'kitap id');
    const input = borrowBookSchema.parse(req.body ?? {});
    const loan = await borrowBook(req.auth!.subjectId, id, input.periodDays);
    res.status(201).json({ loan });
  } catch (err) {
    next(err);
  }
});

// Kullanıcının ödünç geçmişi (aktif/gecikmiş + iade edilmiş).
router.get('/loans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ loans: await listMyLoans(req.auth!.subjectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/loans/:id/return', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    const loan = await returnBook(req.auth!.subjectId, id);
    res.json({ loan });
  } catch (err) {
    next(err);
  }
});

// Süre uzatma talebi (admin onayına gider).
router.post('/loans/:id/extend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    const input = requestExtensionSchema.parse(req.body);
    const loan = await requestExtension(req.auth!.subjectId, id, input.days);
    res.json({ loan });
  } catch (err) {
    next(err);
  }
});

// Bekleyen ödünç talebini iptal et — rezerve edilen kopya geri yüklenir (son-kopya
// süresiz kilidi çözülür). Yalnız status='pending' ve sahibi olan kullanıcı.
router.post('/loans/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    const loan = await cancelPendingLoan(req.auth!.subjectId, id);
    res.json({ loan });
  } catch (err) {
    next(err);
  }
});

export default router;
