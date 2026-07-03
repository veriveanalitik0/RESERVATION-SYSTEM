/**
 * Semantic search (embedding) — kritik testler.
 *
 * Bu testler "geçmişte bu proje var mı" özelliğinin doğruluğunu garanti eder.
 *
 * Kapsam:
 *  1. Embedding üretimi 384-dim vektör döner (MiniLM veya TF-IDF fallback).
 *  2. Cosine similarity matematiği doğru (kendisiyle 1.0, ters vektörle -1.0).
 *  3. saveBookingEmbedding + findSimilarBookings entegrasyon:
 *     - Aynı text → similarity 1'e yakın
 *     - Tematik benzer projeler → yüksek skor
 *     - Tamamen alakasız → düşük skor
 *  4. excludeBookingId: yeni booking kendiyle eşleşmesin.
 *  5. onlyApproved: pending/rejected hariç tutma.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import {
  bookingTextForEmbedding,
  cosineSimilarity,
  findSimilarBookings,
  generateEmbedding,
  saveBookingEmbedding,
  warmupEmbeddings,
} from '../src/services/embedding.service';

const USER_ID = nanoid();
const ROOM_ID = nanoid();

// Test verisi — 3 tematik proje + 1 alakasız
const PROJECTS: Array<{ id: string; name: string; description: string; technologies: string[]; status: 'approved' | 'pending' }> = [
  {
    id: nanoid(),
    name: 'AI bütçe asistanı',
    description:
      'Kullanıcının harcama desenlerini analiz edip Claude API ile tasarruf önerileri sunan akıllı bir asistan. Banka uygulamalarıyla entegre.',
    technologies: ['Claude', 'Python', 'LangChain'],
    status: 'approved',
  },
  {
    id: nanoid(),
    name: 'Müşteri destek chatbot',
    description:
      'Kuveyt Türk müşterileri için doğal dil işleme tabanlı 7/24 destek botu, LangChain ile çoklu kanal entegre.',
    technologies: ['Claude', 'NLP', 'LangChain'],
    status: 'approved',
  },
  {
    id: nanoid(),
    name: 'Kod inceleme aracı',
    description:
      'GitHub PR aşamasında otomatik kod incelemesi yapan, güvenlik açıklarını tespit eden bir CI aracı.',
    technologies: ['Claude', 'GitHub', 'Security'],
    status: 'approved',
  },
  {
    id: nanoid(),
    name: 'Rastgele baz proje',
    description:
      'Tamamen alakasız bir konuda, müzik teorisi ve gitar akorları üzerine küçük bir mobile uygulama. AI yok.',
    technologies: ['Swift', 'iOS'],
    status: 'pending',
  },
];

const futureDate = (daysFromNow: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  await initSchema();
  // Embedding modelini önceden yükle
  await warmupEmbeddings();

  const hash = await argon2.hash('Test1234!Pass', { type: argon2.argon2id });
  await dbRun(
    `INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`,
    [USER_ID, 'emb-user@test.local', hash, 'Embedding Test User']
  );

  await dbRun(
    `INSERT OR IGNORE INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, ?, ?, ?)`,
    [ROOM_ID, 'EMB-01', 'Embedding Test Oda', 'Test', 'Mahalle', 4]
  );

  // Booking'leri ekle ve embedding hesapla
  let dayOffset = 100; // existing booking'lerle çakışmaması için ileri tarihler
  for (const p of PROJECTS) {
    const startDate = futureDate(dayOffset);
    const endDate = futureDate(dayOffset + 30);
    dayOffset += 90;

    await dbRun(
      `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
         project_name, project_description, help_needed, technologies, status)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'yok', ?, ?)`,
      [
        p.id,
        USER_ID,
        ROOM_ID,
        startDate,
        endDate,
        p.name,
        p.description,
        JSON.stringify(p.technologies),
        p.status,
      ]
    );

    const text = bookingTextForEmbedding({
      projectName: p.name,
      projectDescription: p.description,
      technologies: p.technologies,
    });
    await saveBookingEmbedding(p.id, text);
  }
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe('generateEmbedding', () => {
  it("boş text için sıfır vektörü döner", async () => {
    const r = await generateEmbedding('');
    expect(r.dim).toBe(384);
    expect(r.vector.every((v) => v === 0)).toBe(true);
  });

  it('anlamlı text için 384-dim non-zero vektör döner', async () => {
    const r = await generateEmbedding('Claude API ile akıllı asistan geliştirme');
    expect(r.vector).toHaveLength(384);
    const nonZero = r.vector.filter((v) => v !== 0).length;
    expect(nonZero).toBeGreaterThan(50); // dense embedding kontrolü
  });
});

describe('cosineSimilarity', () => {
  it('kendisiyle 1.0', async () => {
    const v = [0.3, 0.4, 0.5, 0.6];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 6);
  });

  it('ters yönlü vektörlerle -1.0', async () => {
    const v = [0.3, 0.4, 0.5];
    const vNeg = v.map((x) => -x);
    expect(cosineSimilarity(v, vNeg)).toBeCloseTo(-1.0, 6);
  });

  it('dik (ortogonal) vektörlerle 0', async () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('farklı uzunluktaki vektörler için 0 döner', async () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('sıfır vektörle 0 döner (NaN değil)', async () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('findSimilarBookings — semantic accuracy', () => {
  it("FINANSAL sorgu → 'AI bütçe asistanı' en üstte", async () => {
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: 'Finansal analiz aracı',
        projectDescription:
          'Para harcamasını analiz eden ve tasarruf önerileri sunan yapay zeka destekli bir uygulama.',
        technologies: ['AI', 'Python'],
      }),
      limit: 5,
      minSimilarity: 0.15,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].projectName).toBe('AI bütçe asistanı');
    expect(results[0].similarity).toBeGreaterThan(0.4);
  });

  it("CHATBOT sorgu → 'Müşteri destek chatbot' en üstte", async () => {
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: 'Sohbet asistanı',
        projectDescription:
          'Müşterilerle doğal dilde sohbet eden, sorularını cevaplayan akıllı destek botu.',
        technologies: ['Chatbot', 'NLP'],
      }),
      limit: 5,
      minSimilarity: 0.15,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].projectName).toBe('Müşteri destek chatbot');
  });

  it("KOD INCELEME sorgu → 'Kod inceleme aracı' en üstte", async () => {
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: 'Pull request denetimi',
        projectDescription:
          'GitHub PR analizleri için güvenlik denetimi yapan otomatik bir CI aracı.',
        technologies: ['GitHub', 'Security'],
      }),
      limit: 5,
      minSimilarity: 0.15,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].projectName).toBe('Kod inceleme aracı');
  });

  it('aynı text query → kendisiyle yüksek similarity (>0.99)', async () => {
    const target = PROJECTS[0];
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: target.name,
        projectDescription: target.description,
        technologies: target.technologies,
      }),
      limit: 5,
      minSimilarity: 0,
    });
    expect(results[0].bookingId).toBe(target.id);
    expect(results[0].similarity).toBeGreaterThan(0.99);
  });

  it('excludeBookingId: kendisi sonuçlardan çıkar', async () => {
    const target = PROJECTS[0];
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: target.name,
        projectDescription: target.description,
        technologies: target.technologies,
      }),
      excludeBookingId: target.id,
      limit: 5,
      minSimilarity: 0,
    });
    expect(results.every((r) => r.bookingId !== target.id)).toBe(true);
  });

  it('onlyApproved: pending booking sonuçlardan çıkar', async () => {
    const results = await findSimilarBookings({
      queryText: 'müzik gitar akor uygulama',
      limit: 5,
      minSimilarity: 0,
      onlyApproved: true,
    });
    expect(results.every((r) => r.status === 'approved')).toBe(true);
  });

  it('minSimilarity threshold: düşük skorlu sonuçlar filtrelenir', async () => {
    const tightResults = await findSimilarBookings({
      queryText: 'kuantum fizik atom çekirdek bozonlar',
      limit: 5,
      minSimilarity: 0.7,
    });
    // Tematik olarak hiç ilgili olmadığı için 0.7 threshold üstü olası değil
    expect(tightResults.length).toBe(0);
  });
});

describe('Privacy — visibility filtresi', () => {
  it("visibility='showcase': pending projeler dahil edilmez", async () => {
    // PROJECTS[3] = 'Rastgele baz proje' status='pending'.
    // Showcase'de visible=1 default'tur ama status='approved' değil → hariç tutulmalı.
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: 'Müzik akor',
        projectDescription: 'Müzik teorisi ve gitar akorları için bir mobile uygulama.',
        technologies: ['Swift', 'iOS'],
      }),
      limit: 5,
      minSimilarity: 0,
      visibility: 'showcase',
    });
    // 'Rastgele baz proje' pending → showcase'de görünmemeli
    expect(results.find((r) => r.projectName === 'Rastgele baz proje')).toBeUndefined();
  });

  it("visibility='showcase' + includeOwner: kendi pending'in görünür", async () => {
    // PROJECTS[3] USER_ID'nin user'ı tarafından yapıldı, pending — kendisi görmeli
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: 'Müzik akor',
        projectDescription: 'Müzik teorisi ve gitar akorları için bir mobile uygulama.',
        technologies: ['Swift', 'iOS'],
      }),
      limit: 5,
      minSimilarity: 0,
      visibility: 'showcase',
      includeOwner: USER_ID,
    });
    const own = results.find((r) => r.projectName === 'Rastgele baz proje');
    expect(own).toBeDefined();
    expect(own?.isOwn).toBe(true);
    // Kendi projesi → gerçek isim
    expect(own?.userFullName).toBe('Embedding Test User');
    expect(own?.anonymized).toBe(false);
  });

  it("visibility='showcase': başkasının approved+visible projesi anonimleşir", async () => {
    // PROJECTS[0..2] approved + showcase_visible=1 default
    // Başka bir user'ı simüle etmek için: includeOwner farklı bir id verelim
    const fakeOtherUserId = 'someone-else-' + Math.random().toString(36).slice(2);
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: 'Finansal araç',
        projectDescription:
          'Para harcamasını analiz eden ve tasarruf önerileri sunan yapay zeka.',
        technologies: ['AI'],
      }),
      limit: 3,
      minSimilarity: 0.3,
      visibility: 'showcase',
      includeOwner: fakeOtherUserId,
    });
    expect(results.length).toBeGreaterThan(0);
    // Hiçbiri isOwn değil → hepsi anonim
    for (const r of results) {
      expect(r.isOwn).toBe(false);
      expect(r.anonymized).toBe(true);
      expect(r.userFullName).toBe('AI Lab Ekibi');
    }
  });

  it("visibility='admin': gerçek isimler korunur, pending dahil", async () => {
    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: 'Müzik akor',
        projectDescription: 'Müzik teorisi ve gitar akorları için bir mobile uygulama.',
        technologies: ['Swift', 'iOS'],
      }),
      limit: 5,
      minSimilarity: 0,
      visibility: 'admin',
    });
    expect(results.find((r) => r.projectName === 'Rastgele baz proje')).toBeDefined();
    // Admin için anonimleştirme yok
    for (const r of results) {
      expect(r.anonymized).toBe(false);
      expect(r.userFullName).not.toBe('AI Lab Ekibi');
    }
  });

  it("showcase_visible=0 olan approved booking dahi gizlenir", async () => {
    // PROJECTS[1] approved, showcase_visible'ı manuel 0 yapalım
    await dbRun('UPDATE bookings SET showcase_visible = 0 WHERE id = ?', [PROJECTS[1].id]);

    const results = await findSimilarBookings({
      queryText: bookingTextForEmbedding({
        projectName: 'Sohbet',
        projectDescription:
          'Müşterilerle doğal dilde konuşan bir destek asistanı tasarımı.',
        technologies: ['Chatbot'],
      }),
      limit: 5,
      minSimilarity: 0,
      visibility: 'showcase',
    });
    expect(results.find((r) => r.bookingId === PROJECTS[1].id)).toBeUndefined();

    // Geri al — sonraki testleri etkilemesin
    await dbRun('UPDATE bookings SET showcase_visible = 1 WHERE id = ?', [PROJECTS[1].id]);
  });
});

describe('bookingTextForEmbedding', () => {
  it('name + description + technologies join eder', async () => {
    const t = bookingTextForEmbedding({
      projectName: 'X',
      projectDescription: 'Y',
      technologies: ['A', 'B'],
    });
    expect(t).toContain('X');
    expect(t).toContain('Y');
    expect(t).toContain('A');
    expect(t).toContain('B');
  });

  it('technologies string olarak verilirse de çalışır', async () => {
    const t = bookingTextForEmbedding({
      projectName: 'X',
      projectDescription: 'Y',
      technologies: 'C D',
    });
    expect(t).toContain('C');
    expect(t).toContain('D');
  });
});
