/**
 * Admin kütüphane rotaları: kitap envanteri CRUD + ödünç/uzatma onayları.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { createBookSchema, updateBookSchema } from '../../validators/schemas';
import {
  listAllBooks,
  getBookByIdAdmin,
  createBook,
  updateBook,
  deleteBook,
  listAllLoans,
  approveLoan,
  rejectLoan,
  approveExtension,
  rejectExtension,
} from '../../services/book.service';
import { HttpError } from '../../middleware/error.middleware';
import { readId } from '../../utils/route-helpers';

const router = Router();

/* ============ KÜTÜPHANE (kitap envanteri + ödünçler) ============ */
// GET'ler requireStaff (izleyici/danışman/arge salt-okunur görebilir); mutasyonlar
// router-seviyesi requireAdmin guard'ı ile yalnız admin'e açıktır.

router.get('/books', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ books: await listAllBooks() });
  } catch (err) {
    next(err);
  }
});

router.get('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'kitap id');
    const book = await getBookByIdAdmin(id);
    if (!book) throw new HttpError(404, 'Kitap bulunamadı.', 'BOOK_NOT_FOUND');
    res.json({ book });
  } catch (err) {
    next(err);
  }
});

router.post('/books', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createBookSchema.parse(req.body);
    const book = await createBook(req.auth!.subjectId, input);
    res.status(201).json({ book });
  } catch (err) {
    next(err);
  }
});

router.put('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'kitap id');
    const input = updateBookSchema.parse(req.body);
    const book = await updateBook(req.auth!.subjectId, id, input);
    res.json({ book });
  } catch (err) {
    next(err);
  }
});

router.delete('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'kitap id');
    await deleteBook(req.auth!.subjectId, id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// Tüm ödünç kayıtları (opsiyonel ?status=pending|active|returned|overdue|rejected).
router.get('/loans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const allowed = ['pending', 'active', 'returned', 'overdue', 'rejected'];
    const filter =
      status && allowed.includes(status)
        ? (status as 'pending' | 'active' | 'returned' | 'overdue' | 'rejected')
        : undefined;
    res.json({ loans: await listAllLoans({ status: filter }) });
  } catch (err) {
    next(err);
  }
});

// Bekleyen ödünç talebini onayla / reddet.
router.post('/loans/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    res.json({ loan: await approveLoan(req.auth!.subjectId, id) });
  } catch (err) {
    next(err);
  }
});

router.post('/loans/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    res.json({ loan: await rejectLoan(req.auth!.subjectId, id) });
  } catch (err) {
    next(err);
  }
});

// Bekleyen süre-uzatma talebini onayla / reddet.
router.post('/loans/:id/extend/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    res.json({ loan: await approveExtension(req.auth!.subjectId, id) });
  } catch (err) {
    next(err);
  }
});

router.post('/loans/:id/extend/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    res.json({ loan: await rejectExtension(req.auth!.subjectId, id) });
  } catch (err) {
    next(err);
  }
});

export default router;
