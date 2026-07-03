/**
 * Booking servisi — kritik akış testleri.
 *
 * Test alanı:
 *  - Tarih çakışması (race condition koruması)
 *  - IDOR (user A, user B'nin booking'ini düzenleyemez)
 *  - Status kısıtı (approved booking düzenlenemez/silinemez)
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun, dbOne } from '../src/db/schema';
import {
  createBooking,
  deleteBooking,
  updateBooking,
  reviewBooking,
  getBookingByIdAdmin,
  selfAdvanceBookingStage,
  requestStageAdvance,
  cancelApprovedBooking,
  advanceBookingLifecycle,
} from '../src/services/booking.service';
import { addMonthsEndDate, periodEndDate } from '../src/utils/dates';
import { createBookingSchema } from '../src/validators/schemas';
import { HttpError } from '../src/middleware/error.middleware';

const USER_A = nanoid();
const USER_B = nanoid();
const ROOM = nanoid();

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER_A, 'a@test.local', hash, 'User A',
  ]);
  await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER_B, 'b@test.local', hash, 'User B',
  ]);
  await dbRun(
    `INSERT INTO rooms (id, code, name, district, neighborhood, capacity)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ROOM, 'TX-01', 'Test · Oda', 'Test', 'Mahalle', 4]
  );
});

afterAll(async () => {
  await closeDb();
});

const futureDate = (daysFromNow: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
};

describe('createBooking', () => {
  it('user A için pending booking oluşturur', async () => {
    const result = await createBooking(USER_A, {
      roomId: ROOM,
      period: '1w',
      startDate: futureDate(7),
      projectName: 'Test Proje',
      projectDescription: 'Birinci test booking açıklaması yeterli uzunlukta.',
      helpNeeded: 'Hiçbiri',
      technologies: ['Claude'],
    });
    expect(result.status).toBe('pending');
    expect(result.userId).toBe(USER_A);
    expect(result.roomCode).toBe('TX-01');
  });

  it('aynı oda + aynı tarihte ÇAKIŞAN booking reddedilir', async () => {
    await expect(createBooking(USER_B, {
        roomId: ROOM,
        period: '1w',
        startDate: futureDate(8), // existing 7..13, new 8..14 → overlap
        projectName: 'İkinci Proje',
        projectDescription: 'İkinci test booking açıklaması — çakışmalı.',
        helpNeeded: 'Hiçbiri',
        technologies: ['GPT'],
      })).rejects.toThrow(HttpError);
  });

  it('çakışma hatası "ne zamana kadar dolu" + en erken müsait tarihi içerir', async () => {
    try {
      await createBooking(USER_B, {
        roomId: ROOM,
        period: '1w',
        startDate: futureDate(8),
        projectName: 'Çakışan Proje',
        projectDescription: 'Çakışma mesajını doğrulayan test booking açıklaması.',
        helpNeeded: 'Hiçbiri',
        technologies: ['GPT'],
      });
      throw new Error('beklenmeyen: çakışma hatası fırlatmadı');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      const msg = (e as HttpError).message;
      expect(msg).toMatch(/dolu/i);
      expect(msg).toMatch(/En erken/i); // en erken müsait tarih bilgisi
      expect(msg).toMatch(/\d{2}\.\d{2}\.\d{4}/); // DD.MM.YYYY tarih(ler)i
    }
  });

  it('aynı oda + farklı (çakışmayan) tarihte ikinci booking oluşturulabilir', async () => {
    const result = await createBooking(USER_B, {
      roomId: ROOM,
      period: '1w',
      startDate: futureDate(90), // 90..96 — overlap yok
      projectName: 'Gelecek Proje',
      projectDescription: 'Çakışmayan ikinci test booking, farklı zamanda.',
      helpNeeded: 'Hiçbiri',
      technologies: ['React'],
    });
    expect(result.status).toBe('pending');
    expect(result.userId).toBe(USER_B);
  });
});

describe('IDOR koruması', () => {
  it("user A, user B'nin booking'ini güncelleyemez", async () => {
    const userBBooking = (await dbOne(
      'SELECT id FROM bookings WHERE user_id = ? LIMIT 1',
      [USER_B]
    )) as { id: string };

    await expect(updateBooking(USER_A, userBBooking.id, {
        roomId: ROOM,
        period: '1w',
        startDate: futureDate(91),
        projectName: 'Çalıntı denemesi',
        projectDescription: 'Bu update başarısız olmalı — IDOR koruması test.',
        helpNeeded: 'Hiçbiri',
        technologies: ['Claude'],
      })).rejects.toThrow(/bulunamadı|BOOKING_NOT_FOUND/i);
  });

  it("user A, user B'nin booking'ini silemez", async () => {
    const userBBooking = (await dbOne(
      'SELECT id FROM bookings WHERE user_id = ? LIMIT 1',
      [USER_B]
    )) as { id: string };

    await expect(deleteBooking(USER_A, userBBooking.id)).rejects.toThrow(/bulunamadı|BOOKING_NOT_FOUND/i);
  });
});

describe('Status kısıtı', () => {
  it('approved booking düzenlenemez', async () => {
    // user A'nın booking'ini approved yap
    const aBooking = (await dbOne(
      'SELECT id FROM bookings WHERE user_id = ? LIMIT 1',
      [USER_A]
    )) as { id: string };
    await dbRun("UPDATE bookings SET status = 'approved' WHERE id = ?", [aBooking.id]);

    await expect(updateBooking(USER_A, aBooking.id, {
        roomId: ROOM,
        period: '1w',
        startDate: futureDate(7),
        projectName: 'Onaylanmış değişmemeli',
        projectDescription: 'Approved booking düzenlenmemeli — status koruması.',
        helpNeeded: 'Hiçbiri',
        technologies: ['Claude'],
      })).rejects.toThrow(/NOT_EDITABLE|düzenlenemez/i);
  });
});

describe('tek onay (yalnız admin karar verir)', () => {
  const DA_ROOM = nanoid();
  const ADMIN_ID = nanoid();

  beforeAll(async () => {
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, 'T','M',4)`, [
      DA_ROOM, 'DA-01', 'Tek Onay Oda',
    ]);
  });

  async function makeBooking(startOffset: number): Promise<string> {
    const b = await createBooking(USER_A, {
      roomId: DA_ROOM,
      period: '1w',
      startDate: futureDate(startOffset),
      projectName: 'Tek onay projesi',
      projectDescription: 'Tek onay senaryosu için yeterli uzunlukta açıklama metni.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    return b.id;
  }

  it('admin onayı TEK BAŞINA yeterli → anında approved + lifecycle development', async () => {
    const id = await makeBooking(10);
    const r = await reviewBooking(ADMIN_ID, id, { action: 'approve' });
    expect(r.booking.status).toBe('approved');
    expect(r.booking.lifecycleStage).toBe('development');
    expect(r.approvalState.adminDecision).toBe('approved');
    // Analitik kararı miras alan — yeni akışta hep null kalır.
    expect(r.approvalState.analystDecision).toBeNull();
  });

  it('admin reddi anında rejected yapar', async () => {
    const id = await makeBooking(60);
    const r = await reviewBooking(ADMIN_ID, id, { action: 'reject', feedback: 'Kapsam uygun değil.' });
    expect(r.booking.status).toBe('rejected');
    expect(r.approvalState.adminDecision).toBe('rejected');
  });

  it('request_feedback kararı sıfırlar ve feedback_requested yapar', async () => {
    const id = await makeBooking(110);
    const r = await reviewBooking(ADMIN_ID, id, { action: 'request_feedback', feedback: 'Lütfen kapsamı netleştirin.' });
    expect(r.booking.status).toBe('feedback_requested');
    expect(r.approvalState.adminDecision).toBeNull();
  });

  it('sonuçlanmış talep tekrar incelenemez (BOOKING_NOT_REVIEWABLE)', async () => {
    const id = await makeBooking(160);
    await reviewBooking(ADMIN_ID, id, { action: 'approve' }); // approved
    await expect(
      reviewBooking(ADMIN_ID, id, { action: 'reject' })
    ).rejects.toThrow(/sonuçlandırılmış|NOT_REVIEWABLE/i);
    const after = await getBookingByIdAdmin(id);
    expect(after?.status).toBe('approved');
  });
});

describe('aşama self-servis ilerleme (canlıya kadar) + canlı onayı', () => {
  const ST_ROOM = nanoid();
  const ADMIN_ID = nanoid();

  beforeAll(async () => {
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, 'T','M',4)`, [
      ST_ROOM, 'ST-01', 'Stage Oda',
    ]);
  });

  async function approvedBooking(startOffset: number): Promise<string> {
    const b = await createBooking(USER_A, {
      roomId: ST_ROOM,
      period: '1w',
      startDate: futureDate(startOffset),
      projectName: 'Aşama projesi',
      projectDescription: 'Aşama self-servis senaryosu için yeterli uzunlukta metin.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    await reviewBooking(ADMIN_ID, b.id, { action: 'approve' });
    return b.id;
  }

  it('kullanıcı development → stage(Test) → production(Pre-Production) kendisi ilerletir', async () => {
    const id = await approvedBooking(10);
    const r1 = await selfAdvanceBookingStage(USER_A, id);
    expect(r1.lifecycleStage).toBe('stage');
    const r2 = await selfAdvanceBookingStage(USER_A, id);
    expect(r2.lifecycleStage).toBe('production');
  });

  it('production → live self-servis DEĞİL (LIVE_REQUIRES_APPROVAL)', async () => {
    const id = await approvedBooking(60);
    await selfAdvanceBookingStage(USER_A, id); // stage
    await selfAdvanceBookingStage(USER_A, id); // production
    await expect(selfAdvanceBookingStage(USER_A, id)).rejects.toThrow(/admin onayı|LIVE_REQUIRES_APPROVAL/i);
  });

  it('canlı onay talebi yalnız production aşamasında açılabilir', async () => {
    const id = await approvedBooking(110);
    // development'ta talep açılamaz — self-servis mesajı döner.
    await expect(requestStageAdvance(USER_A, id)).rejects.toThrow(/onaysız|SELF_SERVICE/i);
    await selfAdvanceBookingStage(USER_A, id); // stage
    await selfAdvanceBookingStage(USER_A, id); // production
    const b = await requestStageAdvance(USER_A, id, 'Kriterler tamam.');
    expect(b.stageAdvanceRequestedAt).toBeTruthy();
  });

  it('IDOR: başka kullanıcı aşama ilerletemez (NOT_OWNED)', async () => {
    const id = await approvedBooking(160);
    await expect(selfAdvanceBookingStage(USER_B, id)).rejects.toThrow(/size ait değil|NOT_OWNED/i);
  });

  it('onaysız (pending) booking aşama ilerletemez', async () => {
    const b = await createBooking(USER_A, {
      roomId: ST_ROOM,
      period: '1w',
      startDate: futureDate(210),
      projectName: 'Pending aşama',
      projectDescription: 'Onaysız booking aşama ilerletme denemesi açıklaması.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    await expect(selfAdvanceBookingStage(USER_A, b.id)).rejects.toThrow(/onaylı|NOT_APPROVED/i);
  });
});

describe('esnek/kısa süreli randevu (manuel endDate)', () => {
  const ROOM_FX = nanoid();
  beforeAll(async () => {
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, 'Esnek','T','M',4)`, [
      ROOM_FX, 'FX-01',
    ]);
  });

  it('manuel kısa bitiş kullanılır (periyot-türevi yerine)', async () => {
    const start = futureDate(5);
    const shortEnd = futureDate(12); // ~1 hafta, 1 aydan kısa
    const b = await createBooking(USER_A, {
      roomId: ROOM_FX,
      period: '1m',
      startDate: start,
      endDate: shortEnd,
      projectName: 'Kısa süreli iş',
      projectDescription: 'Bir haftalık kısa süreli randevu testi açıklaması.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    expect(b.endDate).toBe(shortEnd);
    expect(b.endDate < addMonthsEndDate(start, 1)).toBe(true); // periyottan kısa
  });

  it('manuel bitiş yoksa periyottan türetilir (2 hafta = start+13 gün)', async () => {
    const start = futureDate(120);
    const b = await createBooking(USER_A, {
      roomId: ROOM_FX,
      period: '2w',
      startDate: start,
      projectName: 'Standart süre',
      projectDescription: 'Manuel bitiş verilmeyen standart periyot testi açıklaması.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    expect(b.endDate).toBe(periodEndDate(start, '2w'));
    expect(b.period).toBe('2w');
  });

  it('1 ay periyodu ay-sonu kıskacıyla türetilir', async () => {
    const start = futureDate(200);
    const b = await createBooking(USER_A, {
      roomId: ROOM_FX,
      period: '1m',
      startDate: start,
      projectName: 'Aylık süre',
      projectDescription: 'Bir aylık periyot türetme testi için açıklama metni.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    expect(b.endDate).toBe(addMonthsEndDate(start, 1));
  });

  it('validator: bitiş başlangıçtan önce olamaz', () => {
    const res = createBookingSchema.safeParse({
      roomId: 'x'.repeat(10),
      period: '1w',
      startDate: '2026-08-10',
      endDate: '2026-08-05', // başlangıçtan önce
      projectName: 'Ters tarih',
      projectDescription: 'Bitiş başlangıçtan önce — reddedilmeli, yeterli uzunlukta.',
      helpNeeded: 'Yardım gerek.',
      technologies: ['Claude'],
    });
    expect(res.success).toBe(false);
  });

  it('validator: periyot dışı UZUN bitiş kabul edilir (üst sınır yok)', () => {
    const res = createBookingSchema.safeParse({
      roomId: 'x'.repeat(10),
      period: '1w',
      startDate: '2026-08-10',
      endDate: '2027-02-10', // 1 ay periyot ama 6 ay bitiş → serbest
      projectName: 'Uzun süre',
      projectDescription: 'Periyottan uzun ama üst sınır yok — kabul, yeterli uzunlukta.',
      helpNeeded: 'Yardım gerek.',
      technologies: ['Claude'],
    });
    expect(res.success).toBe(true);
  });
});

describe('kalıcı silme — iptal edilen / canlıya alınan (hazır) projeler', () => {
  const PG_ROOM = nanoid();
  const ADMIN_ID = nanoid();

  beforeAll(async () => {
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, 'T','M',4)`, [
      PG_ROOM, 'PG-01', 'Purge Oda',
    ]);
  });

  async function approvedBooking(startOffset: number): Promise<string> {
    const b = await createBooking(USER_A, {
      roomId: PG_ROOM,
      period: '1w',
      startDate: futureDate(startOffset),
      projectName: 'Silme projesi',
      projectDescription: 'Kalıcı silme senaryosu için yeterli uzunlukta açıklama.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    await reviewBooking(ADMIN_ID, b.id, { action: 'approve' });
    return b.id;
  }

  it('iptal edilmiş (cancelled) proje kalıcı silinebilir', async () => {
    const id = await approvedBooking(10);
    await cancelApprovedBooking(id, { id: USER_A, type: 'user' });
    const res = await deleteBooking(USER_A, id);
    expect(res.deleted).toBe(true);
    expect(await getBookingByIdAdmin(id)).toBeUndefined();
  });

  it('canlıya alınmış (live) proje kalıcı silinebilir ve stage olayları temizlenir', async () => {
    const id = await approvedBooking(60);
    // development → stage → production → live (admin ilerletmesi)
    await advanceBookingLifecycle(ADMIN_ID, id);
    await advanceBookingLifecycle(ADMIN_ID, id);
    await advanceBookingLifecycle(ADMIN_ID, id);
    const live = await getBookingByIdAdmin(id);
    expect(live?.lifecycleStage).toBe('live');

    const res = await deleteBooking(USER_A, id);
    expect(res.deleted).toBe(true);
    expect(await getBookingByIdAdmin(id)).toBeUndefined();
    // Komple silme: stage olayları da gitmiş olmalı (FK'sız tablo, kodla temizlenir).
    const ev = await dbOne(
      'SELECT COUNT(*) AS c FROM project_stage_events WHERE request_id = ?', [id]
    ) as { c: number | string };
    expect(Number(ev.c)).toBe(0);
  });

  it('AKTİF onaylı (live olmayan) proje silinemez — önce iptal gerekir', async () => {
    const id = await approvedBooking(110);
    await expect(deleteBooking(USER_A, id)).rejects.toThrow(/silinemez|NOT_WITHDRAWABLE/i);
  });

  it('reddedilmiş talep hâlâ silinemez', async () => {
    const b = await createBooking(USER_A, {
      roomId: PG_ROOM,
      period: '1w',
      startDate: futureDate(160),
      projectName: 'Reddedilecek',
      projectDescription: 'Reddedilen talep silme kısıtı için açıklama metni.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    await reviewBooking(ADMIN_ID, b.id, { action: 'reject' });
    await expect(deleteBooking(USER_A, b.id)).rejects.toThrow(/silinemez|NOT_WITHDRAWABLE/i);
  });

  it('IDOR: başka kullanıcı iptal edilmiş projeyi silemez', async () => {
    const id = await approvedBooking(210);
    await cancelApprovedBooking(id, { id: USER_A, type: 'user' });
    await expect(deleteBooking(USER_B, id)).rejects.toThrow(/bulunamadı|NOT_FOUND/i);
  });
});
