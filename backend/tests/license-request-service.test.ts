/**
 * Lisans talep servisi — kritik akış testleri.
 *
 * Test alanı:
 *  - createLicenseRequest: junction tablo yazımı (çoklu araç) + katalog fill
 *  - updateLicenseRequest: IDOR + finalized-state reddi + feedback→pending geçişi
 *  - reviewLicenseRequest: state machine (approve/reject/feedback) + finalized reddi
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import {
  createLicenseRequest,
  listUserLicenseRequests,
  reviewLicenseRequest,
  updateLicenseRequest,
  type CreateLicenseRequestInput,
} from '../src/services/license-request.service';
import { LICENSE_CATALOG } from '../src/services/license.service';
import { HttpError } from '../src/middleware/error.middleware';

const USER_A = nanoid();
const USER_B = nanoid();
const ADMIN = nanoid();

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER_A, 'lic-a@test.local', hash, 'Lisans A',
  ]);
  await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER_B, 'lic-b@test.local', hash, 'Lisans B',
  ]);
  await dbRun(`INSERT INTO admins (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)`, [
    ADMIN, 'lic-admin@test.local', hash, 'Lisans Admin', 'admin',
  ]);
});

afterAll(async () => {
  await closeDb();
});

/** Geçerli bir CreateLicenseRequestInput üretir. */
function validInput(overrides: Partial<CreateLicenseRequestInput> = {}): CreateLicenseRequestInput {
  return {
    requestTitle: 'Müşteri Şikayet Sınıflandırma Modeli',
    reason: 'Çağrı merkezine gelen yazılı şikayetleri otomatik kategorilere ayırmak.',
    expectedBenefit: 'Manuel etiketleme süresinde belirgin azalma ve tutarlılık artışı.',
    successCriteria: 'F1 skoru 0.85 ve üzeri, sınıflandırma gecikmesi 200ms altında.',
    items: [{ licenseKey: 'custom', licenseName: 'Özel Araç', vendor: 'Vendor X', category: 'Diğer' }],
    projectType: 'poc',
    estimatedDurationDays: 45,
    dataToUse: 'Anonimleştirilmiş şikayet verisi.',
    technicalStack: 'Python, FastAPI',
    durationMonths: 3,
    usesExternalApi: false,
    involvesRealData: false,
    ...overrides,
  };
}

describe('createLicenseRequest', () => {
  it('pending talep oluşturur ve PNG alanlarını saklar', async () => {
    const r = await createLicenseRequest(USER_A, validInput());
    expect(r.status).toBe('pending');
    expect(r.requestTitle).toBe('Müşteri Şikayet Sınıflandırma Modeli');
    expect(r.expectedBenefit).toContain('azalma');
    expect(r.successCriteria).toContain('F1');
    expect(r.projectType).toBe('poc');
    expect(r.estimatedDurationDays).toBe(45);
    expect(r.dataToUse).toContain('şikayet');
    expect(r.technicalStack).toBe('Python, FastAPI');
  });

  it('SADELEŞTİRİLMİŞ form: yalnız çekirdek alanlarla (ad/amaç/araç/süre) talep oluşur', async () => {
    // Opsiyonel alanlar hiç gönderilmez — server null/varsayılan yazmalı.
    const r = await createLicenseRequest(USER_A, {
      requestTitle: 'Minimal Talep Başlığı',
      reason: 'Sadeleştirilmiş form ile gönderilen çekirdek başvuru gerekçesi.',
      items: [{ licenseKey: 'custom', licenseName: 'Tek Araç', vendor: null, category: null }],
      durationMonths: 6,
    });
    expect(r.status).toBe('pending'); // involvesRealData verilmedi → otomatik red YOK
    expect(r.requestTitle).toBe('Minimal Talep Başlığı');
    expect(r.durationMonths).toBe(6);
    expect(r.items).toHaveLength(1);
    // Gönderilmeyen opsiyonel alanlar null kalmalı.
    expect(r.expectedBenefit).toBeNull();
    expect(r.successCriteria).toBeNull();
    expect(r.projectType).toBeNull();
    expect(r.dataToUse).toBeNull();
    expect(r.technicalStack).toBeNull();
    expect(r.estimatedDurationDays).toBeNull();
    expect(r.usesExternalApi).toBeNull(); // verilmedi → null
    expect(r.involvesRealData).toBe(false); // verilmedi → false (otomatik red tetiklenmez)
    // projectType verilmediğinde governance 'basic' (poc varsayılanı).
    expect(r.governanceLevel).toBe('basic');
  });

  it('çoklu araç gönderilince junction tablosuna sıralı yazar', async () => {
    const r = await createLicenseRequest(
      USER_A,
      validInput({
        items: [
          { licenseKey: 'custom', licenseName: 'Araç 1', vendor: null, category: null },
          { licenseKey: 'custom', licenseName: 'Araç 2', vendor: 'V2', category: 'IDE' },
          { licenseKey: 'custom', licenseName: 'Araç 3', vendor: null, category: null },
        ],
      })
    );
    expect(r.items).toHaveLength(3);
    expect(r.items.map((i) => i.licenseName)).toEqual(['Araç 1', 'Araç 2', 'Araç 3']);
    // İlk item geriye dönük tek-lisans alanlarına da yansır.
    expect(r.licenseName).toBe('Araç 1');
  });

  it('katalog key gönderilince vendor/category katalogdan doldurulur (defense-in-depth)', async () => {
    const catalogKey = Object.keys(LICENSE_CATALOG)[0]!;
    const info = LICENSE_CATALOG[catalogKey]!;
    const r = await createLicenseRequest(
      USER_A,
      validInput({
        items: [{ licenseKey: catalogKey, licenseName: 'YANLIŞ AD', vendor: 'YANLIŞ', category: 'YANLIŞ' }],
      })
    );
    // Frontend yanlış gönderse bile backend katalogdan düzeltir.
    expect(r.items[0]!.vendor).toBe(info.vendor);
    expect(r.items[0]!.category).toBe(info.category);
    expect(r.items[0]!.licenseName).toBe(info.name);
  });

  it('listUserLicenseRequests sadece o kullanıcının taleplerini items ile döner', async () => {
    const before = (await listUserLicenseRequests(USER_B)).length;
    await createLicenseRequest(USER_B, validInput({ requestTitle: 'B kullanıcısı talebi 12345' }));
    const mine = await listUserLicenseRequests(USER_B);
    expect(mine.length).toBe(before + 1);
    expect(mine.every((r) => r.items.length >= 1)).toBe(true);
  });
});

describe('updateLicenseRequest', () => {
  it('pending talebi günceller ve items listesini yeniler', async () => {
    const created = await createLicenseRequest(USER_A, validInput());
    const updated = await updateLicenseRequest(
      USER_A,
      created.id,
      validInput({
        requestTitle: 'Güncellenmiş başlık 98765',
        items: [{ licenseKey: 'custom', licenseName: 'Tek Araç', vendor: null, category: null }],
      })
    );
    expect(updated.requestTitle).toBe('Güncellenmiş başlık 98765');
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]!.licenseName).toBe('Tek Araç');
    expect(updated.status).toBe('pending');
  });

  it('SADELEŞTİRİLMİŞ güncelleme: gönderilmeyen opsiyonel alanlar KORUNUR (veri kaybı yok)', async () => {
    // Eski tarz dolu talep — tüm opsiyonel alanlar dolu, integration → governance 'full'.
    const created = await createLicenseRequest(
      USER_A,
      validInput({
        projectType: 'integration',
        expectedBenefit: 'Eski beklenen fayda metni korunmalı.',
        dataToUse: 'Eski veri tanımı korunmalı.',
      })
    );
    expect(created.governanceLevel).toBe('full');
    // Sadeleştirilmiş form: yalnız çekirdek alanları gönder (opsiyoneller undefined).
    const updated = await updateLicenseRequest(USER_A, created.id, {
      requestTitle: 'Yalnız başlık güncellendi 55555',
      reason: created.reason,
      items: created.items,
      durationMonths: created.durationMonths,
    });
    expect(updated.requestTitle).toBe('Yalnız başlık güncellendi 55555');
    // Gönderilmeyen opsiyonel alanlar ESKİ değerini korumalı (silinmemeli).
    expect(updated.expectedBenefit).toBe('Eski beklenen fayda metni korunmalı.');
    expect(updated.dataToUse).toBe('Eski veri tanımı korunmalı.');
    expect(updated.projectType).toBe('integration');
    expect(updated.governanceLevel).toBe('full'); // downgrade YOK
  });

  it('feedback_requested talebi güncellenince statü pending olur', async () => {
    const created = await createLicenseRequest(USER_A, validInput());
    await reviewLicenseRequest(ADMIN, created.id, { action: 'request_feedback', adminFeedback: 'Detay ver.' });
    const updated = await updateLicenseRequest(USER_A, created.id, validInput({ reason: 'Revize edilmiş gerekçe metni.' }));
    expect(updated.status).toBe('pending');
  });

  it('IDOR: başka kullanıcının talebini güncelleyemez (404)', async () => {
    const created = await createLicenseRequest(USER_A, validInput());
    await expect(updateLicenseRequest(USER_B, created.id, validInput())).rejects.toThrow(HttpError);
    try {
      await updateLicenseRequest(USER_B, created.id, validInput());
    } catch (e) {
      expect((e as HttpError).status).toBe(404);
    }
  });

  it('sonuçlanmış (approved) talep güncellenemez (400)', async () => {
    const created = await createLicenseRequest(USER_A, validInput());
    await reviewLicenseRequest(ADMIN, created.id, { action: 'approve' });
    try {
      await updateLicenseRequest(USER_A, created.id, validInput());
      throw new Error('beklenmeyen: hata fırlatmadı');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
    }
  });
});

describe('reviewLicenseRequest', () => {
  it('approve → status approved + reviewer kaydı', async () => {
    const created = await createLicenseRequest(USER_A, validInput());
    const reviewed = await reviewLicenseRequest(ADMIN, created.id, { action: 'approve' });
    expect(reviewed.status).toBe('approved');
    expect(reviewed.reviewedBy).toBe(ADMIN);
    expect(reviewed.reviewedAt).toBeTruthy();
  });

  it('reject → status rejected + admin notu', async () => {
    const created = await createLicenseRequest(USER_A, validInput());
    const reviewed = await reviewLicenseRequest(ADMIN, created.id, {
      action: 'reject',
      adminFeedback: 'Bütçe dışı.',
    });
    expect(reviewed.status).toBe('rejected');
    expect(reviewed.adminFeedback).toBe('Bütçe dışı.');
  });

  it('sonuçlanmış talep tekrar review edilemez (400)', async () => {
    const created = await createLicenseRequest(USER_A, validInput());
    await reviewLicenseRequest(ADMIN, created.id, { action: 'approve' });
    try {
      await reviewLicenseRequest(ADMIN, created.id, { action: 'reject' });
      throw new Error('beklenmeyen: hata fırlatmadı');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
    }
  });

  it('var olmayan talep → 404', async () => {
    try {
      await reviewLicenseRequest(ADMIN, 'olmayan-id-123', { action: 'approve' });
      throw new Error('beklenmeyen: hata fırlatmadı');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(404);
    }
  });
});
