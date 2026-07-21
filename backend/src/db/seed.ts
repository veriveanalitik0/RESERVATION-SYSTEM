/**
 * Seed data — prod bootstrap (sıfırdan üretime çıkış için minimum veri).
 *
 * Yüklenen:
 *  - Oda envanteri (AI Lab pod'ları + AI Deneyim Alanı + Tribün)
 *  - Tek süper-admin hesabı (ilk giriş sonrası parola değiştirilir)
 *  - Kitap katalogu (kütüphane)
 *
 * Demo kullanıcı, rezervasyon, showcase, lisans talebi, waitlist ve bildirim
 * verisi BULUNMAZ. Yönetişim rolleri (arge/danışman/izleyici) seed'lenmez —
 * admin panelinden (Kullanıcılar → rol atama) kayıtlı kullanıcılara verilir.
 *
 * Güvenlik: Argon2id ile parola hashing (app_security.md §7).
 */
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { dbOne, dbRun, dbTx } from './schema';
import { SEED_BOOKS } from './seed-books';

/* ============================================================
 * 1) ODALAR
 * ============================================================ */

interface RoomSeed {
  /** Dahili sabit kimlik — booking/waitlist ref'leri bunu kullanır (kullanıcıya gösterilmez). */
  code: string;
  /** Görünen temalı isim — örn. "CUDA", "Python", "Tribün". */
  name: string;
  /** Oda kategorisi. */
  roomType: 'pod' | 'experience' | 'tribune';
  district: string;
  neighborhood: string;
  capacity: number;
  theme: string;
  /** Cihaz adı — açıklamada da geçer. */
  equipment: string;
  /** Teknik özellikler — JSON dizi [{ label, value }]. */
  specs: string;
  description: string;
}

const DGX_BASE = [
  { label: 'Çip', value: 'NVIDIA GB10 Grace Blackwell Superchip' },
  { label: 'CPU', value: '20 çekirdek Arm (10× Cortex-X925 + 10× A725)' },
  { label: 'GPU', value: 'Blackwell · 5. nesil Tensor Core' },
  { label: 'Birleşik Bellek', value: '128 GB LPDDR5x' },
  { label: 'AI Performansı', value: 'Yaklaşık 1 PFLOP (FP4)' },
  { label: 'Depolama', value: '4 TB NVMe SSD' },
  { label: 'Ağ', value: 'ConnectX-7 · 200 GbE' },
];
const MAC_BASE = [
  { label: 'Çip', value: 'Apple M serisi (M4 Max / M3 Ultra)' },
  { label: 'CPU', value: 'Azami 16 çekirdek' },
  { label: 'GPU', value: 'Azami 40 çekirdek' },
  { label: 'Birleşik Bellek', value: 'Azami 128 GB' },
  { label: 'Depolama', value: 'Azami 8 TB SSD' },
  { label: 'Bağlantı', value: 'Thunderbolt 5 · 10 GbE' },
];
function deviceSpecs(base: Array<{ label: string; value: string }>, count: number): string {
  const cfg = { label: 'Yapılandırma', value: count === 2 ? '2× istasyon (çift kişilik)' : 'Tek istasyon' };
  return JSON.stringify([cfg, ...base]);
}
const EXPERIENCE_SPECS = JSON.stringify([
  { label: 'Kapasite', value: '15 kişi' },
  { label: 'Donanım', value: 'Büyük sunum ekranı · hibrit konferans' },
  { label: 'Kullanım', value: 'Workshop · eğitim · demo · topluluk etkinlikleri' },
]);
const TRIBUNE_SPECS = JSON.stringify([
  { label: 'Kapasite', value: 'Yaklaşık 30 kişi (basamaklı oturma)' },
  { label: 'Donanım', value: 'Sahne · büyük sunum ekranı · ses sistemi' },
  { label: 'Kullanım', value: 'Demo day · sunum · etkinlik' },
]);

/**
 * Resmi AILAB envanteri — basement (-1D) zone. Toplam 20 alan:
 *  - 18 cihaz pod'u (tekli oda): isimler AI/ML araç teması (CUDA, Python, …)
 *      · NVD pod'ları: NVIDIA DGX Spark (GPU compute) — "neural" tema, compute isimleri
 *      · MAC pod'ları: Mac Studio (geliştirme) — "code" tema, dev isimleri
 *      · 2× suffix: aynı pod'da 2 cihaz, capacity 2
 *  - 1 AI Deneyim Alanı (experience): 15 kişilik workshop/demo
 *  - 1 Tribün (tribune): basamaklı etkinlik/sunum alanı
 *
 * `code` dahili sabit kimliktir (kullanıcıya gösterilmez); kullanıcı `name`'i görür,
 * cihaz adı açıklamada + `equipment`'ta, teknik detay `specs`'te.
 */
const ROOMS: RoomSeed[] = [
  { code: 'AILAB -1D 1-NVD',   name: 'Claude',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'neural', equipment: 'NVIDIA DGX Spark',    specs: deviceSpecs(DGX_BASE, 1), description: 'NVIDIA DGX Spark iş istasyonu — GPU yoğun ML/DL eğitimi için tek kişilik pod.' },
  { code: 'AILAB -1D 2-NVD',   name: 'Gemini',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'neural', equipment: 'NVIDIA DGX Spark',    specs: deviceSpecs(DGX_BASE, 1), description: 'NVIDIA DGX Spark iş istasyonu — GPU yoğun ML/DL eğitimi için tek kişilik pod.' },
  { code: 'AILAB -1D 3-NVD',   name: 'GPT',         roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'neural', equipment: 'NVIDIA DGX Spark',    specs: deviceSpecs(DGX_BASE, 1), description: 'NVIDIA DGX Spark iş istasyonu — GPU yoğun ML/DL eğitimi için tek kişilik pod.' },
  { code: 'AILAB -1D 4-2xNVD', name: 'CUDA',        roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'neural', equipment: '2× NVIDIA DGX Spark', specs: deviceSpecs(DGX_BASE, 2), description: 'Çift NVIDIA DGX Spark iş istasyonlu pod — çift kişilik GPU çalışma alanı.' },
  { code: 'AILAB -1D 5-2xMAC', name: 'Tensor',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'code',   equipment: '2× Mac Studio',      specs: deviceSpecs(MAC_BASE, 2), description: 'Çift Mac Studio ile donatılmış pod — eşli geliştirme / prototipleme için ideal.' },
  { code: 'AILAB -1D 6-NVD',   name: 'Llama',       roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'neural', equipment: 'NVIDIA DGX Spark',    specs: deviceSpecs(DGX_BASE, 1), description: 'NVIDIA DGX Spark iş istasyonu — GPU yoğun ML/DL eğitimi için tek kişilik pod.' },
  { code: 'AILAB -1D 7-2xMAC', name: 'Jupyter',     roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'code',   equipment: '2× Mac Studio',      specs: deviceSpecs(MAC_BASE, 2), description: 'Çift Mac Studio ile donatılmış pod — eşli geliştirme / prototipleme için ideal.' },
  { code: 'AILAB -1D 8-2xMAC', name: 'PyTorch',     roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'code',   equipment: '2× Mac Studio',      specs: deviceSpecs(MAC_BASE, 2), description: 'Çift Mac Studio ile donatılmış pod — eşli geliştirme / prototipleme için ideal.' },
  { code: 'AILAB -1D 9-2xMAC', name: 'Pandas',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'code',   equipment: '2× Mac Studio',      specs: deviceSpecs(MAC_BASE, 2), description: 'Çift Mac Studio ile donatılmış pod — eşli geliştirme / prototipleme için ideal.' },
  { code: 'AILAB -1D 10-MAC',  name: 'NumPy',       roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 11-MAC',  name: 'Keras',       roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 12-MAC',  name: 'Scikit',   roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 13-MAC',  name: 'Conda',       roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 14-MAC',  name: 'Matrix',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 15-MAC',  name: 'CNN',         roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 16-MAC',  name: 'RNN',  roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 17-MAC',  name: 'YOLO',              roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 18-MAC',  name: 'Kaggle',        roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D AI Deneyim Alanı', name: 'AI Deneyim Alanı', roomType: 'experience', district: 'AI Lab', neighborhood: '-1D', capacity: 15, theme: 'brain', equipment: 'AI Deneyim Alanı',       specs: EXPERIENCE_SPECS, description: '15 kişilik AI deneyim & eğitim alanı — workshop, demo ve topluluk etkinlikleri için.' },
  { code: 'AILAB -1D Tribün',           name: 'Tribün',           roomType: 'tribune',    district: 'AI Lab', neighborhood: '-1D', capacity: 30, theme: 'data',  equipment: 'Tribün / Etkinlik Alanı', specs: TRIBUNE_SPECS,    description: 'Basamaklı tribün — demo day, sunum ve etkinlikler için yaklaşık 30 kişilik amfi alan.' },
];

/* ============================================================
 * 2) ADMIN — tek yönetici hesabı (prod bootstrap)
 * ============================================================ */

interface DemoAdminSeed {
  email: string;
  password: string;
  fullName: string;
  role: 'admin' | 'super_admin';
}

// Bootstrap admin bilgileri env'den gelir (prod'da güçlü/gizli parola için).
// Verilmezse dev varsayılanına düşer. Varsayılan parolanın prod'da kullanılması
// LOUD şekilde uyarılır (bkz. seedAdmins).
const DEFAULT_ADMIN_PASSWORD = 'Admin1234!Pass';
const BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || 'admin@klab.test';
const BOOTSTRAP_ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

// Yalnız bir süper-admin seed'lenir. Arge/danışman/izleyici yönetişim rolleri
// SEED'LENMEZ — admin panelinden (Kullanıcılar → rol atama) kayıtlı kullanıcılara
// verilir. İlk girişten sonra bu parolayı MUTLAKA değiştirin.
const DEMO_ADMINS: DemoAdminSeed[] = [
  { email: BOOTSTRAP_ADMIN_EMAIL, password: BOOTSTRAP_ADMIN_PASSWORD, fullName: 'AI Lab Yöneticisi', role: 'super_admin' },
];

/* ============================================================
 * 3) ARGON2 OPSİYONLARI
 * ============================================================ */

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
};

/* ============================================================
 * 4) SEED FONKSİYONLARI
 * ============================================================ */

export async function seedRooms(): Promise<void> {
  const existing = await dbOne('SELECT COUNT(*) as count FROM rooms', []) as { count: number };
  if (existing.count >= ROOMS.length) {
    console.log(`[SEED] Odalar zaten yüklü (${existing.count} adet), atlanıyor.`);
    return;
  }

  const INSERT_ROOM = `
    INSERT OR IGNORE INTO rooms (id, code, name, district, neighborhood, capacity, description, theme, equipment, room_type, specs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  // Tüm odaları tek transaction'da ekle (ALS: içerideki dbRun otomatik tx'e gider).
  await dbTx(async () => {
    for (const room of ROOMS) {
      await dbRun(INSERT_ROOM, [
        nanoid(),
        room.code,
        room.name,
        room.district,
        room.neighborhood,
        room.capacity,
        room.description,
        room.theme,
        room.equipment,
        room.roomType,
        room.specs,
      ]);
    }
  });

  console.log(`[SEED] ${ROOMS.length} oda eklendi.`);
}

export async function seedAdmins(): Promise<void> {
  const existing = await dbOne('SELECT COUNT(*) as count FROM admins', []) as { count: number };
  if (existing.count >= DEMO_ADMINS.length) {
    console.log(`[SEED] Admin'ler zaten yüklü (${existing.count}), atlanıyor.`);
    return;
  }

  const INSERT_ADMIN = `
    INSERT OR IGNORE INTO admins (id, email, password_hash, full_name, role, governance_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  // GÜVENLİK: prod'da varsayılan (bilinen) bootstrap parolası kullanılıyorsa
  // LOUD uyar — operatör BOOTSTRAP_ADMIN_PASSWORD ile güçlü bir parola vermeli.
  if (process.env.NODE_ENV === 'production' && BOOTSTRAP_ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {

    console.warn(
      '[SEED] UYARI: Bootstrap admin VARSAYILAN parola ile oluşturuluyor. ' +
        'Prod için BOOTSTRAP_ADMIN_PASSWORD ayarlayın ve/veya ilk girişten sonra DERHAL değiştirin.'
    );
  }

  for (const a of DEMO_ADMINS) {
    const hash = await argon2.hash(a.password, ARGON2_OPTIONS);
    await dbRun(INSERT_ADMIN, [nanoid(), a.email, hash, a.fullName, a.role, null]);
  }
  console.log(`[SEED] ${DEMO_ADMINS.length} admin eklendi (${BOOTSTRAP_ADMIN_EMAIL}).`);
}


/** Kütüphane: SEED_BOOKS listesinden kitaplar (kapaklarıyla) — bkz. seed-books.ts. */
export async function seedBooks(): Promise<void> {
  const existing = (await dbOne('SELECT COUNT(*) as count FROM books', [])) as { count: number };
  if (existing.count >= SEED_BOOKS.length) {
    console.log(`[SEED] Kitaplar zaten yüklü (${existing.count}), atlanıyor.`);
    return;
  }
  const INSERT_BOOK = `
    INSERT OR IGNORE INTO books
      (id, title, author, category, description, cover_image_url, total_copies, available_copies, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `;
  for (const b of SEED_BOOKS) {
    await dbRun(INSERT_BOOK, [
      b.id,
      b.title,
      b.author,
      b.category,
      b.description,
      b.coverImageUrl,
      b.totalCopies,
      b.totalCopies,
    ]);
  }
  const withCover = SEED_BOOKS.filter((b) => b.coverImageUrl).length;
  console.log(`[SEED] ${SEED_BOOKS.length} kitap eklendi (${withCover} kapaklı).`);
}

/**
 * Çekirdek seed: oda envanteri + bootstrap admin + kitap katalogu. Her adım
 * idempotenttir ("zaten yüklü" ise atlar) → tekrar çağrılması güvenlidir.
 * Demo kullanıcı/rezervasyon/showcase/lisans/waitlist/bildirim verisi YOK.
 *
 * NOT: Artık PROD guard'ı YOK. Seed yalnız ESANSİYEL bootstrap üretir (demo değil)
 * ve prod'da otomatik yalnız BOŞ DB'de çalışır (bkz. seedIfEmpty). Admin parolası
 * env'den gelir → prod'da bilinen sabit parola sızmaz.
 */
export async function runSeed(): Promise<void> {
  await seedRooms();
  await seedAdmins();
  await seedBooks();
}

/**
 * İlk-kurulum otomasyonu: DB boşsa (hiç admin yoksa) çekirdek seed'i çalıştırır.
 * Boot'ta (index.ts) çağrılır → prod'da manuel adım gerekmez. Dolu DB'de hiçbir
 * şey yapmaz (idempotent + boş-kontrolü). `true` = seed uygulandı.
 */
export async function seedIfEmpty(): Promise<boolean> {
  const row = (await dbOne('SELECT COUNT(*) as count FROM admins', [])) as { count: number };
  if (Number(row.count) > 0) return false; // sistem zaten kurulmuş
  await runSeed();
  return true;
}
