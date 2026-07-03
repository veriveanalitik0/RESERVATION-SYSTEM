/**
 * Seed data: 10 oda + 18 kullanıcı + 2 admin + ~30 booking + sosyal engagement.
 *
 * Güvenlik:
 * - Argon2id ile password hashing (app_security.md §7).
 * - Demo credential'lar sadece DEV ortamında; prod'da bunlar yer almaz.
 *
 * Demo amaçlıdır — Vercel canlı demo için sahnelenmiş veri (Kuveyt Türk AI Lab
 * vibe coding atmosferi).
 */
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun, dbTx } from './schema';
import { SEED_BOOKS } from './seed-books';
import {
  GATE_DEFINITIONS,
  applicableGates,
  type GateKey,
  type GovernanceLevel,
} from '../services/governance-data';

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
  { code: 'AILAB -1D 1-NVD',   name: 'CUDA',        roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'neural', equipment: 'NVIDIA DGX Spark',    specs: deviceSpecs(DGX_BASE, 1), description: 'NVIDIA DGX Spark iş istasyonu — GPU yoğun ML/DL eğitimi için tek kişilik pod.' },
  { code: 'AILAB -1D 2-NVD',   name: 'Tensor',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'neural', equipment: 'NVIDIA DGX Spark',    specs: deviceSpecs(DGX_BASE, 1), description: 'NVIDIA DGX Spark iş istasyonu — GPU yoğun ML/DL eğitimi için tek kişilik pod.' },
  { code: 'AILAB -1D 3-NVD',   name: 'Triton',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'neural', equipment: 'NVIDIA DGX Spark',    specs: deviceSpecs(DGX_BASE, 1), description: 'NVIDIA DGX Spark iş istasyonu — GPU yoğun ML/DL eğitimi için tek kişilik pod.' },
  { code: 'AILAB -1D 4-2xNVD', name: 'JAX',         roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'neural', equipment: '2× NVIDIA DGX Spark', specs: deviceSpecs(DGX_BASE, 2), description: 'Çift NVIDIA DGX Spark iş istasyonlu pod — çift kişilik GPU çalışma alanı.' },
  { code: 'AILAB -1D 5-2xMAC', name: 'Python',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'code',   equipment: '2× Mac Studio',      specs: deviceSpecs(MAC_BASE, 2), description: 'Çift Mac Studio ile donatılmış pod — eşli geliştirme / prototipleme için ideal.' },
  { code: 'AILAB -1D 6-NVD',   name: 'Llama',       roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'neural', equipment: 'NVIDIA DGX Spark',    specs: deviceSpecs(DGX_BASE, 1), description: 'NVIDIA DGX Spark iş istasyonu — GPU yoğun ML/DL eğitimi için tek kişilik pod.' },
  { code: 'AILAB -1D 7-2xMAC', name: 'Jupyter',     roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'code',   equipment: '2× Mac Studio',      specs: deviceSpecs(MAC_BASE, 2), description: 'Çift Mac Studio ile donatılmış pod — eşli geliştirme / prototipleme için ideal.' },
  { code: 'AILAB -1D 8-2xMAC', name: 'PyTorch',     roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'code',   equipment: '2× Mac Studio',      specs: deviceSpecs(MAC_BASE, 2), description: 'Çift Mac Studio ile donatılmış pod — eşli geliştirme / prototipleme için ideal.' },
  { code: 'AILAB -1D 9-2xMAC', name: 'Pandas',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 2,  theme: 'code',   equipment: '2× Mac Studio',      specs: deviceSpecs(MAC_BASE, 2), description: 'Çift Mac Studio ile donatılmış pod — eşli geliştirme / prototipleme için ideal.' },
  { code: 'AILAB -1D 10-MAC',  name: 'NumPy',       roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 11-MAC',  name: 'Keras',       roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 12-MAC',  name: 'ANALYTICS',   roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 13-MAC',  name: 'Conda',       roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 14-MAC',  name: 'Streamlit',   roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 15-MAC',  name: 'Gradio',      roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 16-MAC',  name: 'HuggingFace', roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 17-MAC',  name: 'Ray',         roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D 18-MAC',  name: 'DATA',        roomType: 'pod', district: 'AI Lab', neighborhood: '-1D', capacity: 1,  theme: 'code',   equipment: 'Mac Studio',         specs: deviceSpecs(MAC_BASE, 1), description: 'Mac Studio iş istasyonu — bireysel geliştirme pod’u.' },
  { code: 'AILAB -1D AI Deneyim Alanı', name: 'AI Deneyim Alanı', roomType: 'experience', district: 'AI Lab', neighborhood: '-1D', capacity: 15, theme: 'brain', equipment: 'AI Deneyim Alanı',       specs: EXPERIENCE_SPECS, description: '15 kişilik AI deneyim & eğitim alanı — workshop, demo ve topluluk etkinlikleri için.' },
  { code: 'AILAB -1D Tribün',           name: 'Tribün',           roomType: 'tribune',    district: 'AI Lab', neighborhood: '-1D', capacity: 30, theme: 'data',  equipment: 'Tribün / Etkinlik Alanı', specs: TRIBUNE_SPECS,    description: 'Basamaklı tribün — demo day, sunum ve etkinlikler için yaklaşık 30 kişilik amfi alan.' },
];

/**
 * Eski demo verilerinde kullanılan KT-01..KT-10 oda kodları → yeni AILAB pod'larına
 * eşlemesi. Booking ve waitlist seed'leri bu map üzerinden yeni kodlara çözülür.
 * Yeni eklenen kodlar yine ROOMS array'inde mevcuttur — yapıyı korur.
 */
const LEGACY_ROOM_CODE_MAP: Record<string, string> = {
  'KT-01': 'AILAB -1D 1-NVD',
  'KT-02': 'AILAB -1D 2-NVD',
  'KT-03': 'AILAB -1D 3-NVD',
  'KT-04': 'AILAB -1D 4-2xNVD',
  'KT-05': 'AILAB -1D 5-2xMAC',
  'KT-06': 'AILAB -1D 6-NVD',
  'KT-07': 'AILAB -1D 7-2xMAC',
  'KT-08': 'AILAB -1D 8-2xMAC',
  'KT-09': 'AILAB -1D 9-2xMAC',
  'KT-10': 'AILAB -1D 10-MAC',
};

function resolveRoomCode(legacyOrNew: string): string {
  return LEGACY_ROOM_CODE_MAP[legacyOrNew] ?? legacyOrNew;
}

/* ============================================================
 * 2) KULLANICILAR — 18 kişi (zengin profil)
 * ============================================================ */

interface DemoUserSeed {
  email: string;
  password: string;
  fullName: string;
  department?: string;
  title?: string;
  manager?: string;
  bio?: string;
  /** Yönetişim rolü — admin'in atadığı role demo amaçlı seed'de set. */
  governanceRole?: 'analitik_danisman' | 'yz_arge' | 'izleyici';
}

const DEMO_USERS: DemoUserSeed[] = [
  { email: 'user@klab.test',          password: 'Demo1234!Pass',    fullName: 'Demo Kullanıcı',  department: 'AI Lab',                title: 'Demo Hesabı',                manager: 'AI Lab Yöneticisi', bio: 'Demo kullanıcı — sistemi keşfetmek için.' },
  { email: 'ayse.yilmaz@klab.test',   password: 'Ayse1234!Pass',    fullName: 'Ayşe Yılmaz',     department: 'Veri Bilimleri',         title: 'Kıdemli Veri Bilimcisi',     manager: 'Cem Aslan',         bio: 'NLP & öneri sistemleri üzerine çalışıyor; LangChain ve Hugging Face ekosisteminde yetkin.', governanceRole: 'analitik_danisman' },
  { email: 'mehmet.demir@klab.test',  password: 'Mehmet1234!',      fullName: 'Mehmet Demir',    department: 'Bireysel Bankacılık',    title: 'Ürün Yöneticisi',            manager: 'Pınar Korkmaz',     bio: 'Müşteri deneyimi ve dijital onboarding ürünlerini yönetiyor.' },
  { email: 'zeynep.kaya@klab.test',   password: 'Zeynep1234!Pass',  fullName: 'Zeynep Kaya',     department: 'Risk Yönetimi',          title: 'Risk Analisti',              manager: 'Tolga Aydın',       bio: 'Kredi risk modellemesi ve dolandırıcılık tespiti odaklı.' },
  { email: 'emre.aksoy@klab.test',    password: 'Emre1234!Pass',    fullName: 'Emre Aksoy',      department: 'BT Operasyonları',       title: 'DevOps Mühendisi',           manager: 'Berk Erdoğan',      bio: 'Kubernetes, AWS ve CI/CD pipeline tasarımı.' },
  { email: 'selin.dogan@klab.test',   password: 'Selin1234!Pass',   fullName: 'Selin Doğan',     department: 'Müşteri Deneyimi',       title: 'UX Tasarımcısı',             manager: 'Pınar Korkmaz',     bio: 'Mobil bankacılık akışlarını araştırıyor; Figma + kullanıcı testleri.' },
  { email: 'burak.sahin@klab.test',   password: 'Burak1234!Pass',   fullName: 'Burak Şahin',     department: 'AI Lab',                 title: 'ML Mühendisi',               manager: 'Cem Aslan',         bio: 'LLM fine-tuning ve RAG mimarileri.', governanceRole: 'yz_arge' },
  { email: 'defne.arslan@klab.test',  password: 'Defne1234!Pass',   fullName: 'Defne Arslan',    department: 'Yatırım Bankacılığı',    title: 'Kantitatif Analist',         manager: 'Tolga Aydın',       bio: 'Sayısal portföy optimizasyonu, time-series forecasting.' },
  { email: 'kerem.ozturk@klab.test',  password: 'Kerem1234!Pass',   fullName: 'Kerem Öztürk',    department: 'Bireysel Bankacılık',    title: 'Yazılım Geliştirici',        manager: 'Pınar Korkmaz',     bio: 'React + Next.js, müşteri portalı geliştiriyor.' },
  { email: 'elif.celik@klab.test',    password: 'Elif1234!Pass',    fullName: 'Elif Çelik',      department: 'Veri Bilimleri',         title: 'Veri Mühendisi',             manager: 'Cem Aslan',         bio: 'Streaming pipeline\'lar (Kafka + Flink), data quality.' },
  { email: 'furkan.polat@klab.test',  password: 'Furkan1234!Pass',  fullName: 'Furkan Polat',    department: 'AI Lab',                 title: 'Computer Vision Mühendisi',  manager: 'Cem Aslan',         bio: 'OCR, doküman anlama, YOLO & DETR modelleri.' },
  { email: 'naz.yildiz@klab.test',    password: 'Naz1234!PassWord', fullName: 'Naz Yıldız',      department: 'Müşteri Deneyimi',       title: 'Servis Tasarımcısı',         manager: 'Pınar Korkmaz',     bio: 'End-to-end müşteri yolculuğu, journey map\'leme.' },
  { email: 'izleyici@klab.test',      password: 'Izleyici1234!',    fullName: 'Gözlem Yetkilisi', department: 'Yönetim',               title: 'İzleyici',                   manager: 'AI Lab Yöneticisi', bio: 'Salt-okunur görüntüleme hesabı — doluluk ve talepleri izler.', governanceRole: 'izleyici' },
  { email: 'onur.acar@klab.test',     password: 'Onur1234!Pass',    fullName: 'Onur Acar',       department: 'Kurumsal Bankacılık',    title: 'Çözüm Mimarı',               manager: 'Berk Erdoğan',      bio: 'API entegrasyonları, açık bankacılık.' },
  { email: 'begum.kilic@klab.test',   password: 'Begum1234!Pass',   fullName: 'Begüm Kılıç',     department: 'AI Lab',                 title: 'Yazılım Geliştirici',        manager: 'Cem Aslan',         bio: 'FastAPI + PostgreSQL backend\'leri.' },
  { email: 'tolga.aydin@klab.test',   password: 'Tolga1234!Pass',   fullName: 'Tolga Aydın',     department: 'Risk Yönetimi',          title: 'Risk Direktörü',             manager: 'Pınar Korkmaz',     bio: 'Tüm risk modellerinin yönetimi.' },
  { email: 'pinar.korkmaz@klab.test', password: 'Pinar1234!Pass',   fullName: 'Pınar Korkmaz',   department: 'Müşteri Deneyimi',       title: 'Müdür',                      manager: 'Cem Aslan',         bio: 'Müşteri deneyimi grubunun yöneticisi.' },
  { email: 'cem.aslan@klab.test',     password: 'Cem1234!PassWord', fullName: 'Cem Aslan',       department: 'AI Lab',                 title: 'AI Lab Direktörü',           manager: '—',                 bio: 'AI Lab kurucusu, ML ve veri stratejisi.' },
  { email: 'berk.erdogan@klab.test',  password: 'Berk1234!Pass',    fullName: 'Berk Erdoğan',    department: 'BT Operasyonları',       title: 'BT Müdürü',                  manager: 'Cem Aslan',         bio: 'Bulut altyapısı ve siber güvenlik.' },
];

/* ============================================================
 * 3) ADMINLER — 2 kişi
 * ============================================================ */

interface DemoAdminSeed {
  email: string;
  password: string;
  fullName: string;
  role: 'admin' | 'super_admin';
  governanceRole?: 'analitik_danisman' | 'lab_muhendisi' | 'yz_arge';
}

const DEMO_ADMINS: DemoAdminSeed[] = [
  { email: 'admin@klab.test',     password: 'Admin1234!Pass',  fullName: 'Demo Admin',          role: 'super_admin' },
  { email: 'ai.admin@klab.test',  password: 'AILab1234!Pass',  fullName: 'AI Lab Yöneticisi',   role: 'admin', governanceRole: 'yz_arge' },
];

/* ============================================================
 * 4) BOOKING'LER — ~30 proje (vibe coding projeleri)
 * ============================================================ */

type BookingStatus = 'pending' | 'approved' | 'rejected' | 'feedback_requested';

interface BookingSeed {
  /** Kullanıcı email — sahibi belirler. */
  userEmail: string;
  /** Oda kodu — KT-01..KT-10. */
  roomCode: string;
  periodMonths: 1 | 2 | 3;
  /** YYYY-MM-DD — başlangıç. */
  startDate: string;
  projectName: string;
  projectDescription: string;
  helpNeeded: string;
  technologies: string[];
  status: BookingStatus;
  adminFeedback?: string;
  /** Highlighted (envanterde öne çıkar). */
  highlight?: boolean;
  /**
   * Onaylı booking'in proje yaşam döngüsü aşaması. Verilmezse approved booking'ler
   * 'development' (ilk onay sonrası aşama) ile başlar — application aşamasında
   * TAKILMAZLAR. application yalnız onay bekleyen (pending/feedback) talepler içindir.
   */
  lifecycleStage?: 'application' | 'development' | 'stage' | 'production' | 'live';
}

/**
 * Tarih hesap yardımcısı — bugünden offset gün uzaklıkta YYYY-MM-DD üretir.
 * Demo verisi: bazı booking'ler geçmişte (tamamlanmış), bazıları aktif,
 * bazıları gelecekte (ileride başlayacak).
 */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const BOOKINGS: BookingSeed[] = [
  // ---------- APPROVED (ortaya çıkar) ----------
  {
    userEmail: 'ayse.yilmaz@klab.test', roomCode: 'KT-03', periodMonths: 3, startDate: dayOffset(-90),
    projectName: 'AI Müşteri Hizmetleri Asistanı',
    projectDescription: 'Türkçe LLM tabanlı, müşteri taleplerini sınıflandırıp uygun aksiyon öneren chatbot. Bankacılık terimleriyle fine-tune edildi, RAG ile politika döküman desteği. Pilot ekiplerin destek sürelerini %35 düşürdü.',
    helpNeeded: 'Türkçe LLM\'ye bankacılık jargonu için fine-tune dataset hazırlanmasında yardım. KVKK uyumluluğu için PII scrubber.',
    technologies: ['Python', 'PyTorch', 'Hugging Face', 'LangChain', 'FastAPI', 'PostgreSQL'],
    status: 'approved',
    highlight: true,
  },
  {
    userEmail: 'furkan.polat@klab.test', roomCode: 'KT-10', periodMonths: 2, startDate: dayOffset(-60),
    projectName: 'Faturadan Otomatik Gider Tanıma (OCR)',
    projectDescription: 'Mobil bankacılık kullanıcılarının fotoğrafladığı faturalardan tutar, KDV, tedarikçi adını otomatik çıkaran OCR+NER pipeline\'ı. Türkçe fatura formatlarına özel data augmentation.',
    helpNeeded: 'Türkçe fatura verisi etiketlemek için anotatör desteği. Edge cihazda inference optimizasyonu.',
    technologies: ['Python', 'PyTorch', 'OpenCV', 'EasyOCR', 'spaCy', 'Docker'],
    status: 'approved',
    highlight: true,
  },
  {
    userEmail: 'zeynep.kaya@klab.test', roomCode: 'KT-05', periodMonths: 3, startDate: dayOffset(-75),
    projectName: 'Gerçek Zamanlı Dolandırıcılık Tespiti',
    projectDescription: 'EFT/havale işlemlerinde 50ms altında karar veren XGBoost + autoencoder ensemble modeli. Açıklanabilir AI (SHAP) ile risk analistlerine gerekçe sunar.',
    helpNeeded: 'Üretim ortamına geçişte düşük latency için ONNX/Triton optimizasyonu.',
    technologies: ['Python', 'XGBoost', 'PyTorch', 'Apache Kafka', 'Redis', 'ONNX', 'Streamlit'],
    status: 'approved',
    highlight: true,
  },
  {
    userEmail: 'burak.sahin@klab.test', roomCode: 'KT-06', periodMonths: 2, startDate: dayOffset(-45),
    projectName: 'Bankacılık Sesli Asistan',
    projectDescription: 'Mobil uygulamadan sesli komutla bakiye, kart limiti, son işlemler sorgulama. Whisper STT + özel intent classifier + TTS.',
    helpNeeded: 'Türkçe konuşma dilinde özel komutların (yöresel ifadeler) tanınması.',
    technologies: ['Python', 'OpenAI Whisper', 'PyTorch', 'FastAPI', 'WebSocket', 'React Native'],
    status: 'approved',
  },
  {
    userEmail: 'defne.arslan@klab.test', roomCode: 'KT-02', periodMonths: 1, startDate: dayOffset(-30),
    projectName: 'Doğal Dil ile SQL Sorguları',
    projectDescription: 'Analistlerin "Geçen ay İstanbul\'da en yüksek hacimli 10 kurumsal müşteri" gibi sorularını otomatik SQL\'e çeviren araç. Schema-aware prompt + safety guardrails.',
    helpNeeded: 'Üretim DB\'sine güvenli erişim için row-level security pattern\'i.',
    technologies: ['Python', 'OpenAI API', 'LangChain', 'PostgreSQL', 'Next.js', 'TypeScript'],
    status: 'approved',
    highlight: true,
  },
  {
    userEmail: 'elif.celik@klab.test', roomCode: 'KT-08', periodMonths: 3, startDate: dayOffset(-100),
    projectName: 'Sözleşme Sınıflandırma & Riskli Madde Tespiti',
    projectDescription: 'Kurumsal kredi sözleşmelerini otomatik kategorize edip yüksek riskli maddeleri (cezai şart, fesih, gizlilik ihlali) işaretler. Embedding tabanlı benzerlik araması.',
    helpNeeded: 'Hukuk ekibiyle birlikte etiketleme rehberi geliştirme.',
    technologies: ['Python', 'sentence-transformers', 'spaCy', 'FastAPI', 'PostgreSQL pgvector'],
    status: 'approved',
  },
  {
    userEmail: 'kerem.ozturk@klab.test', roomCode: 'KT-01', periodMonths: 2, startDate: dayOffset(-50),
    projectName: 'Kişiye Özel Ürün Önerisi (Recommender)',
    projectDescription: 'Müşterinin işlem geçmişi + demografik veri + segment bilgisinden kredi kartı, mevduat, yatırım ürünü önerisi. Hybrid collaborative + content-based.',
    helpNeeded: 'Cold-start probleminde (yeni müşteri) feature engineering.',
    technologies: ['Python', 'TensorFlow Recommenders', 'BigQuery', 'Airflow', 'Streamlit'],
    status: 'approved',
  },
  {
    userEmail: 'begum.kilic@klab.test', roomCode: 'KT-07', periodMonths: 1, startDate: dayOffset(-25),
    projectName: 'Anomali Tespit Dashboard\'u',
    projectDescription: 'Şube işlem hacimlerinde anormal düşüş/yükselişleri saniyeler içinde yakalayıp Slack\'e alert atan dashboard. Isolation Forest + LSTM autoencoder.',
    helpNeeded: 'False positive oranını düşürmek için adaptif threshold.',
    technologies: ['Python', 'scikit-learn', 'TensorFlow', 'Grafana', 'Prometheus', 'FastAPI'],
    status: 'approved',
  },
  {
    userEmail: 'onur.acar@klab.test', roomCode: 'KT-04', periodMonths: 1, startDate: dayOffset(-20),
    projectName: 'Açık Bankacılık API Sözleşme Analizörü',
    projectDescription: 'Üçüncü taraf fintech\'lerle yapılan API sözleşmelerini otomatik analiz edip uyumluluk kontrol listesi çıkarır. PSD2/KVKK kontrolü.',
    helpNeeded: 'Hukuk ve compliance ekiplerinden domain insight.',
    technologies: ['Python', 'OpenAI API', 'spaCy', 'Streamlit', 'PostgreSQL'],
    status: 'approved',
  },
  {
    userEmail: 'naz.yildiz@klab.test', roomCode: 'KT-06', periodMonths: 2, startDate: dayOffset(-80),
    projectName: 'Müşteri Yolculuğu Görselleştirici',
    projectDescription: 'Anonim event verisinden müşterilerin ürün adoption yolculuğunu sankey diyagramı + heatmap olarak gösteren analitik araç.',
    helpNeeded: 'Frontend\'de büyük graph render performansı.',
    technologies: ['TypeScript', 'D3.js', 'React', 'Next.js', 'ClickHouse'],
    status: 'approved',
  },
  {
    userEmail: 'selin.dogan@klab.test', roomCode: 'KT-09', periodMonths: 1, startDate: dayOffset(-15),
    projectName: 'Mobil Onboarding UX Test Asistanı',
    projectDescription: 'Yeni müşteri onboarding adımlarında kullanıcı davranışını analiz eden, drop-off noktalarına müdahale öneren tool. Heatmap + session replay.',
    helpNeeded: 'KVKK uyumlu session recording (PII otomatik maskeleme).',
    technologies: ['TypeScript', 'React', 'PostHog', 'PostgreSQL'],
    status: 'approved',
  },
  {
    userEmail: 'emre.aksoy@klab.test', roomCode: 'KT-08', periodMonths: 2, startDate: dayOffset(-70),
    projectName: 'Akıllı Sözleşme Audit Aracı',
    projectDescription: 'Solidity sözleşmelerini statik analiz + LLM ile inceleyip yaygın güvenlik açıklarını (reentrancy, integer overflow) raporlayan CI/CD entegre tool.',
    helpNeeded: 'Cardano/Tezos için destek genişletme.',
    technologies: ['Python', 'Slither', 'OpenAI API', 'GitHub Actions', 'Docker'],
    status: 'approved',
  },
  {
    userEmail: 'ayse.yilmaz@klab.test', roomCode: 'KT-05', periodMonths: 1, startDate: dayOffset(-10),
    projectName: 'Gerçek Zamanlı Türkçe Toplantı Çevirisi',
    projectDescription: 'Uluslararası iş ortakları ile yapılan toplantılarda canlı Türkçe-İngilizce çift yönlü çeviri + kalıcı transcript. Edge cihazda çalışır.',
    helpNeeded: 'Bankacılık terimleri için özel sözlük entegrasyonu.',
    technologies: ['Python', 'OpenAI Whisper', 'NLLB', 'WebRTC', 'React'],
    status: 'approved',
  },
  {
    userEmail: 'furkan.polat@klab.test', roomCode: 'KT-03', periodMonths: 2, startDate: dayOffset(-110),
    projectName: 'Bilgi Grafiği ile Kurumsal Arama',
    projectDescription: 'Banka içi dökümanları, e-postaları, wiki sayfalarını semantic search + knowledge graph ile birleştiren kurumsal arama motoru.',
    helpNeeded: 'Authorization layer (hangi çalışan hangi dökümana erişebilir).',
    technologies: ['Python', 'Neo4j', 'sentence-transformers', 'Elasticsearch', 'Next.js'],
    status: 'approved',
  },
  {
    userEmail: 'mehmet.demir@klab.test', roomCode: 'KT-10', periodMonths: 1, startDate: dayOffset(-5),
    projectName: 'Pazarlama Görsel Üretici',
    projectDescription: 'Şubeler için yerel kampanya görselleri (Stable Diffusion + LoRA fine-tune) üreten araç. Marka kurallarına uygun, hızlı iterasyon.',
    helpNeeded: 'Marka rehberini görsel prompt\'a çevirmek için template sistemi.',
    technologies: ['Python', 'Stable Diffusion', 'PyTorch', 'Streamlit', 'AWS S3'],
    status: 'approved',
  },
  {
    userEmail: 'zeynep.kaya@klab.test', roomCode: 'KT-07', periodMonths: 1, startDate: dayOffset(-35),
    projectName: 'Müşteri Şikayet Duygu Analizi',
    projectDescription: 'Sosyal medya ve şikayet kanallarındaki yorumları gerçek zamanlı analiz edip kritik vakaları öncelikli kuyruğa atan duygu analizi sistemi.',
    helpNeeded: 'İronik / sarkastik Türkçe ifadelerde model performansı.',
    technologies: ['Python', 'BERTurk', 'FastAPI', 'Redis', 'React'],
    status: 'approved',
  },

  // ---------- PENDING (admin onay bekliyor) ----------
  {
    userEmail: 'kerem.ozturk@klab.test', roomCode: 'KT-04', periodMonths: 1, startDate: dayOffset(15),
    projectName: 'Sentetik KYC Veri Üretici',
    projectDescription: 'KVKK uyumlu test ortamı için sentetik müşteri verisi üreten araç. Differential privacy + GAN tabanlı.',
    helpNeeded: 'Gerçek dağılıma yakınlık testleri için istatistiksel doğrulama framework\'ü.',
    technologies: ['Python', 'PyTorch', 'SDV (Synthetic Data Vault)', 'Streamlit'],
    status: 'pending',
  },
  {
    userEmail: 'defne.arslan@klab.test', roomCode: 'KT-03', periodMonths: 2, startDate: dayOffset(20),
    projectName: 'Şube Trafiği Saatlik Tahmin Modeli',
    projectDescription: 'Şube ziyaretçi yoğunluğunu saat bazında tahmin edip kasiyer planlamasına input veren time-series modeli.',
    helpNeeded: 'Tatil/özel gün etkisini modellemek için harici takvim entegrasyonu.',
    technologies: ['Python', 'Prophet', 'LightGBM', 'Airflow', 'PostgreSQL'],
    status: 'pending',
  },
  {
    userEmail: 'naz.yildiz@klab.test', roomCode: 'KT-02', periodMonths: 1, startDate: dayOffset(7),
    projectName: 'Erişilebilirlik Otomatik Test Aracı',
    projectDescription: 'Mobil uygulama ekranlarını WCAG 2.1 AA uyumluluğu için otomatik test eden tool. Renk kontrastı, dokunma alanı, screen reader uyumu.',
    helpNeeded: 'Görme engelli kullanıcılarla yapılacak kullanılabilirlik testlerinin organizasyonu.',
    technologies: ['TypeScript', 'Playwright', 'axe-core', 'React Native'],
    status: 'pending',
  },
  {
    userEmail: 'onur.acar@klab.test', roomCode: 'KT-09', periodMonths: 1, startDate: dayOffset(10),
    projectName: 'API Performans Anomali Dedektörü',
    projectDescription: 'Açık bankacılık API\'larının yanıt sürelerini izleyip anomalileri tespit edip otomatik incident açan tool.',
    helpNeeded: 'PagerDuty entegrasyonu ve incident playbook standardı.',
    technologies: ['Python', 'Prometheus', 'Grafana', 'scikit-learn'],
    status: 'pending',
  },

  // ---------- FEEDBACK REQUESTED (kullanıcı revize etmeli) ----------
  {
    userEmail: 'elif.celik@klab.test', roomCode: 'KT-01', periodMonths: 2, startDate: dayOffset(30),
    projectName: 'Federated Learning Pilot Çalışması',
    projectDescription: 'Müşteri verisini şube dışına çıkarmadan model eğitimini sağlayan federated learning altyapısı pilotu.',
    helpNeeded: 'Pilot için seçilecek 3 şube ve KVKK görüşü.',
    technologies: ['Python', 'PyTorch', 'Flower', 'Docker', 'Kubernetes'],
    status: 'feedback_requested',
    adminFeedback: 'Konsept çok değerli. Lütfen pilot kapsamını ve KPI\'ları daha somut yazınız — hangi metrikle başarı ölçülecek? KVKK ekibiyle ön görüşmenizi tamamlayıp sonucu paylaşabilir misiniz?',
  },
  {
    userEmail: 'burak.sahin@klab.test', roomCode: 'KT-06', periodMonths: 3, startDate: dayOffset(40),
    projectName: 'Çoklu Modlu Belge Anlama Sistemi',
    projectDescription: 'Form + tablo + el yazısı + imza içeren karmaşık dökümanları tek modelde anlama (LayoutLM tabanlı).',
    helpNeeded: 'Eğitim verisi için yıllık 10K döküman erişim izni.',
    technologies: ['Python', 'PyTorch', 'LayoutLM', 'Donut', 'FastAPI'],
    status: 'feedback_requested',
    adminFeedback: 'Veri erişim talebinizi compliance ekibine yönlendiriyorum. Eğitim verisinin nasıl anonimleştirileceğini açıklayan ek bir tasarım dökümanı bekliyorum.',
  },
  {
    userEmail: 'mehmet.demir@klab.test', roomCode: 'KT-08', periodMonths: 1, startDate: dayOffset(12),
    projectName: 'A/B Test Otomasyon Platformu',
    projectDescription: 'Pazarlama ve ürün ekiplerinin self-service A/B test çalıştırabileceği platform.',
    helpNeeded: 'İstatistiksel power hesaplama yardımcısı.',
    technologies: ['TypeScript', 'Next.js', 'PostgreSQL', 'Redis'],
    status: 'feedback_requested',
    adminFeedback: 'Bu zaten Müşteri Deneyimi ekibinin yol haritasında. Onlarla görüşüp birleştirme veya alternatif kapsam belirleyebilir misiniz?',
  },

  // ---------- REJECTED (reddedilmiş) ----------
  {
    userEmail: 'onur.acar@klab.test', roomCode: 'KT-05', periodMonths: 3, startDate: dayOffset(60),
    projectName: 'Kripto Para Alım-Satım Botu',
    projectDescription: 'Bankanın kendi portföyüyle algoritmik kripto trading yapan bot prototipi.',
    helpNeeded: 'Düzenleyici kurum onay süreci.',
    technologies: ['Python', 'CCXT', 'TensorFlow'],
    status: 'rejected',
    adminFeedback: 'Mevcut düzenleyici çerçeve gereği kurum portföyü ile spekülatif kripto işlemi yapılamaz. Lütfen bu kapsamı kapatın; piyasa risk analizi yönünde alternatif fikirlere açığız.',
  },
  {
    userEmail: 'emre.aksoy@klab.test', roomCode: 'KT-10', periodMonths: 2, startDate: dayOffset(80),
    projectName: 'Şube Kamera Yüz Tanıma Pilotu',
    projectDescription: 'Şube içi güvenlik kamerasından yüz tanıma ile VIP müşteri tespiti.',
    helpNeeded: 'Hukuk + KVKK görüşü.',
    technologies: ['Python', 'OpenCV', 'FaceNet'],
    status: 'rejected',
    adminFeedback: 'KVKK ve biyometrik veri işleme açısından yüksek riskli; mevcut framework içinde uygulanabilir değil. Müşteri onayı + alternatif kanal (mobil uygulama) yaklaşımı önerilir.',
  },
];

/* ============================================================
 * 5) ARGON2 OPSİYONLARI
 * ============================================================ */

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
};

/* ============================================================
 * 6) SEED FONKSİYONLARI
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

export async function seedUsers(): Promise<void> {
  const existing = await dbOne('SELECT COUNT(*) as count FROM users', []) as { count: number };
  if (existing.count >= DEMO_USERS.length) {
    console.log(`[SEED] User'lar zaten yüklü (${existing.count}), atlanıyor.`);
    return;
  }

  const INSERT_USER = `
    INSERT OR IGNORE INTO users (id, email, password_hash, full_name, department, title, manager, bio, governance_role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  for (const u of DEMO_USERS) {
    const hash = await argon2.hash(u.password, ARGON2_OPTIONS);
    await dbRun(INSERT_USER, [
      nanoid(),
      u.email,
      hash,
      u.fullName,
      u.department ?? null,
      u.title ?? null,
      u.manager ?? null,
      u.bio ?? null,
      u.governanceRole ?? null,
    ]);
  }
  console.log(`[SEED] ${DEMO_USERS.length} user eklendi.`);
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

  for (const a of DEMO_ADMINS) {
    const hash = await argon2.hash(a.password, ARGON2_OPTIONS);
    await dbRun(INSERT_ADMIN, [nanoid(), a.email, hash, a.fullName, a.role, a.governanceRole ?? null]);
  }
  console.log(`[SEED] ${DEMO_ADMINS.length} admin eklendi.`);
}

export async function seedBookings(): Promise<void> {
  const existing = await dbOne('SELECT COUNT(*) as count FROM bookings', []) as { count: number };
  if (existing.count > 0) {
    console.log(`[SEED] Booking'ler zaten yüklü (${existing.count}), atlanıyor.`);
    return;
  }

  // Lookup tablolarını çek
  const users = await dbAll('SELECT id, email FROM users', []) as Array<{ id: string; email: string }>;
  const rooms = await dbAll('SELECT id, code FROM rooms', []) as Array<{ id: string; code: string }>;
  const admins = await dbAll('SELECT id FROM admins WHERE role = ?', ['super_admin']) as Array<{ id: string }>;
  const reviewerId = admins[0]?.id ?? null;

  const userByEmail = new Map(users.map((u) => [u.email, u.id]));
  const roomByCode = new Map(rooms.map((r) => [r.code, r.id]));

  const INSERT_BOOKING = `
    INSERT INTO bookings (
      id, user_id, room_id, period_months, start_date, end_date,
      project_name, project_description, help_needed, technologies,
      status, admin_feedback, reviewed_by, reviewed_at,
      showcase_visible, showcase_highlight, lifecycle_stage, stage_entered_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  // Onaylı booking'lere demo amaçlı aşama dağıt (pipeline'ın her sütunu dolsun).
  const APPROVED_STAGE_CYCLE = ['development', 'stage', 'production', 'live'] as const;
  let approvedIdx = 0;

  let inserted = 0;
  for (const b of BOOKINGS) {
    const userId = userByEmail.get(b.userEmail);
    // Eski demo verilerindeki KT-01..KT-10 kodlarını yeni AILAB pod kodlarına çevir.
    const roomId = roomByCode.get(resolveRoomCode(b.roomCode));
    if (!userId || !roomId) {
      console.warn(`[SEED] Booking atlandı (user veya oda bulunamadı): ${b.projectName}`);
      continue;
    }

    // end_date = start_date + periodMonths
    const start = new Date(b.startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + b.periodMonths);
    const endDate = end.toISOString().split('T')[0];

    // Admin'in review yaptığı tarih = approve/reject ise start_date - 2 gün, feedback ise start_date - 1 gün
    const isReviewed = b.status !== 'pending';
    const reviewedAt = isReviewed
      ? new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Approve edilmiş booking'ler envanterde görünür
    const showcaseVisible = b.status === 'approved' ? 1 : 0;
    const highlight = b.highlight && b.status === 'approved' ? 1 : 0;

    // Yaşam döngüsü aşaması: onaylılar application'da TAKILMAZ → development+ (veya
    // açıkça verilen aşama / demo için dağıtılmış). Diğerleri application.
    let lifecycleStage = 'application';
    let stageEnteredAt = '';
    if (b.status === 'approved') {
      lifecycleStage = b.lifecycleStage ?? APPROVED_STAGE_CYCLE[approvedIdx % APPROVED_STAGE_CYCLE.length];
      approvedIdx++;
      stageEnteredAt = reviewedAt ?? new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    }

    await dbRun(INSERT_BOOKING, [
      nanoid(),
      userId,
      roomId,
      b.periodMonths,
      b.startDate,
      endDate,
      b.projectName,
      b.projectDescription,
      b.helpNeeded,
      JSON.stringify(b.technologies),
      b.status,
      b.adminFeedback ?? null,
      isReviewed ? reviewerId : null,
      reviewedAt,
      showcaseVisible,
      highlight,
      lifecycleStage,
      stageEnteredAt,
      // created_at = start_date - 3 gün (talep oluşturulma zamanı)
      new Date(start.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      reviewedAt ?? new Date(start.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    ]);
    inserted++;
  }

  console.log(`[SEED] ${inserted} booking eklendi (yaklaşık ${BOOKINGS.filter((b) => b.status === 'approved').length} approved, ${BOOKINGS.filter((b) => b.status === 'pending').length} pending, ${BOOKINGS.filter((b) => b.status === 'feedback_requested').length} feedback, ${BOOKINGS.filter((b) => b.status === 'rejected').length} rejected).`);
}

export async function seedShowcaseEngagement(): Promise<void> {
  const existing = await dbOne('SELECT COUNT(*) as count FROM showcase_likes', []) as { count: number };
  if (existing.count > 0) {
    console.log(`[SEED] Showcase engagement zaten yüklü (${existing.count}), atlanıyor.`);
    return;
  }

  // Approved booking'leri ve user'ları çek
  const approved = await dbAll(`SELECT id FROM bookings WHERE status = 'approved' AND showcase_visible = 1`, []) as Array<{ id: string }>;
  const users = await dbAll('SELECT id, full_name FROM users', []) as Array<{ id: string; full_name: string }>;
  if (approved.length === 0 || users.length === 0) return;

  const INSERT_LIKE = `INSERT OR IGNORE INTO showcase_likes (id, booking_id, user_id) VALUES (?, ?, ?)`;
  const INSERT_COMMENT = `INSERT INTO showcase_comments (id, booking_id, user_id, user_full_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`;

  const commentTemplates = [
    'Süper iş, denedik biz de — ekip çok beğendi!',
    'Bu fikir gerçekten ihtiyacımız olan şeydi.',
    'Tebrikler, mimari kararlar çok net.',
    'Demo\'yu izledik, çok etkileyici.',
    'Bizim ekiple ortak bir POC yapabilir miyiz?',
    'Veri pipeline\'ı için iletişime geçelim mi?',
    'Çok temiz bir çözüm, gerçekten.',
    'Bu hangi konferansta sunulacak?',
  ];

  let likeCount = 0;
  let commentCount = 0;

  for (const booking of approved) {
    // Her approved booking için 2-6 random like
    const likeUsers = users.sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 5));
    for (const u of likeUsers) {
      const r = await dbRun(INSERT_LIKE, [nanoid(), booking.id, u.id]);
      if (r.changes > 0) likeCount++;
    }
    // Her approved booking için 1-3 random comment
    const commentUsers = users.sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3));
    for (const u of commentUsers) {
      const body = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
      const daysAgo = Math.floor(Math.random() * 14);
      const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
      await dbRun(INSERT_COMMENT, [nanoid(), booking.id, u.id, u.full_name, body, createdAt]);
      commentCount++;
    }
  }

  console.log(`[SEED] ${likeCount} like + ${commentCount} yorum eklendi.`);
}

/* ============================================================
 * LİSANS TALEPLERİ — demo verisi
 * ============================================================ */

interface LicenseToolSeed {
  licenseKey: string;
  licenseName: string;
  vendor?: string | null;
  category?: string | null;
}

interface LicenseRequestSeed {
  userEmail: string;
  // Birincil araç — geriye dönük license_requests kolonları + ilk item.
  licenseKey: string;
  licenseName: string;
  vendor?: string | null;
  category?: string | null;
  // Ek araçlar (çoklu seçim) — primary ile birlikte license_request_items'a yazılır.
  extraTools?: LicenseToolSeed[];
  // PNG "Başvuru Formu" alanları (4.1.1)
  requestTitle: string;
  reason: string; // Kullanım Amacı
  expectedBenefit: string;
  successCriteria: string;
  projectType: 'poc' | 'integration';
  estimatedDurationDays?: number | null;
  dataToUse: string;
  technicalStack?: string | null;
  durationMonths: 1 | 3 | 6 | 12;
  status: 'pending' | 'approved' | 'rejected' | 'feedback_requested';
  adminFeedback?: string;
  daysAgoCreated?: number; // default 7
  // Yönetişim alanları
  usesExternalApi?: boolean;
  involvesRealData?: boolean;
  reviewTrack?: 'standard' | 'swat';
  /** Onaylı başvuruların ilerlediği yaşam döngüsü aşaması (kapı/onay seed'ler). */
  targetStage?: 'development' | 'stage' | 'production' | 'live';
}

const LICENSE_REQUESTS: LicenseRequestSeed[] = [
  // Approved
  {
    userEmail: 'ayse.yilmaz@klab.test',
    licenseKey: 'claude code',
    licenseName: 'Claude Code',
    vendor: 'Anthropic',
    category: 'AI Assistant',
    extraTools: [
      { licenseKey: 'cursor', licenseName: 'Cursor', vendor: 'Cursor', category: 'IDE' },
    ],
    requestTitle: 'NLP Pipeline Prototip Hızlandırma',
    reason: 'NLP pilot ekibindeki günlük kod üretimi için Claude Code kullanmam gerekiyor. Mevcut LangChain pipeline\'larına entegre edip prototip hızını 2-3x artırmayı hedefliyorum.',
    expectedBenefit: 'Prototip geliştirme süresinde %50-60 kısalma; sprint başına 1 ek deney koşturabilme.',
    successCriteria: 'Pipeline iterasyon süresi 3 günden 1 güne inmeli; ekip 3 ay içinde 2 yeni model PoC\'u tamamlamalı.',
    projectType: 'integration',
    estimatedDurationDays: 90,
    dataToUse: 'Anonimleştirilmiş çağrı merkezi transkriptleri (iç kaynak, ~120K kayıt).',
    technicalStack: 'Python, LangChain, Hugging Face Transformers, FastAPI',
    durationMonths: 12,
    status: 'approved',
    adminFeedback: 'IT ekibi lisans atadı. Faturalandırma AI Lab cost center\'a.',
    daysAgoCreated: 25,
    usesExternalApi: false,
    targetStage: 'live',
  },
  {
    userEmail: 'furkan.polat@klab.test',
    licenseKey: 'cursor',
    licenseName: 'Cursor',
    vendor: 'Cursor',
    category: 'IDE',
    requestTitle: 'Computer Vision Geliştirme Ortamı',
    reason: 'Computer Vision çalışmalarında PyTorch + OpenCV kod yazımı için Cursor\'ın AI tab completion özelliği kritik. VSCode\'a geçişten sonra verimlilik %40 arttı.',
    expectedBenefit: 'Model eğitim kodu yazım süresinde %40 azalma; doküman anlama projesinin teslimini öne çekme.',
    successCriteria: 'OCR doğruluğu mevcut %88\'den %93\'e çıkmalı; haftalık 1 model deneyi tamamlanmalı.',
    projectType: 'integration',
    estimatedDurationDays: 120,
    dataToUse: 'Açık veri (DocBank, FUNSD) + anonimleştirilmiş kurum içi form görüntüleri.',
    technicalStack: 'Python, PyTorch, OpenCV, YOLO, DETR',
    durationMonths: 12,
    status: 'approved',
    daysAgoCreated: 60,
    usesExternalApi: false,
    targetStage: 'production',
  },
  {
    userEmail: 'burak.sahin@klab.test',
    licenseKey: 'claude',
    licenseName: 'Claude',
    vendor: 'Anthropic',
    category: 'AI Assistant',
    requestTitle: 'RAG Mimarisi Araştırması',
    reason: 'RAG ve LLM fine-tuning araştırması için Claude Pro\'ya ihtiyacım var. Uzun context (200K) ve yüksek kalite çıktı kritik.',
    expectedBenefit: 'Kurum içi doküman arama kalitesinde ölçülebilir artış; manuel bilgi arama süresinde tasarruf.',
    successCriteria: 'RAG cevap isabeti (RAGAS faithfulness) ≥ 0.80; 200K context ile özetleme PoC\'u çalışır halde.',
    projectType: 'poc',
    estimatedDurationDays: 60,
    dataToUse: 'Sentetik soru-cevap seti + açık erişimli kurumsal politika dokümanları.',
    technicalStack: 'Python, LlamaIndex, ChromaDB',
    durationMonths: 6,
    status: 'approved',
    daysAgoCreated: 40,
    usesExternalApi: false,
    targetStage: 'stage',
  },
  {
    userEmail: 'kerem.ozturk@klab.test',
    licenseKey: 'github copilot',
    licenseName: 'GitHub Copilot',
    vendor: 'GitHub',
    category: 'AI Assistant',
    requestTitle: 'Müşteri Portalı Geliştirme',
    reason: 'Müşteri portalı React + Next.js geliştirme için Copilot kullanıyorum, tab completion günlük 2-3 saat zaman kazandırıyor.',
    expectedBenefit: 'Geliştirici başına günlük 2-3 saat zaman tasarrufu; sprint hızında ölçülebilir artış.',
    successCriteria: 'Sprint velocity %20 artmalı; kod review\'da yakalanan basit hata sayısı azalmalı.',
    projectType: 'integration',
    estimatedDurationDays: null,
    dataToUse: 'Veri kullanılmıyor — yalnızca uygulama kodu geliştirme aracı.',
    technicalStack: 'TypeScript, React, Next.js',
    durationMonths: 12,
    status: 'approved',
    daysAgoCreated: 90,
    usesExternalApi: false,
    targetStage: 'development',
  },

  // Pending (admin onayı bekliyor)
  {
    userEmail: 'zeynep.kaya@klab.test',
    licenseKey: 'cursor',
    licenseName: 'Cursor',
    vendor: 'Cursor',
    category: 'IDE',
    requestTitle: 'Risk Modeli İterasyon Ortamı',
    reason: 'Risk model geliştirme için Cursor ile XGBoost + autoencoder pipeline\'larını daha hızlı iterate edebilirim. Mevcut PyCharm setup\'ım yavaş.',
    expectedBenefit: 'Model deney döngüsünün hızlanması; çeyrek başına daha fazla risk senaryosu test edebilme.',
    successCriteria: 'Dolandırıcılık tespit modelinde recall ≥ 0.90, false-positive oranı < %5.',
    projectType: 'poc',
    estimatedDurationDays: 75,
    dataToUse: 'Sentetik işlem verisi + anonimleştirilmiş kredi risk veri seti (iç kaynak).',
    technicalStack: 'Python, XGBoost, scikit-learn, PyTorch',
    durationMonths: 6,
    status: 'pending',
    daysAgoCreated: 3,
  },
  {
    userEmail: 'defne.arslan@klab.test',
    licenseKey: 'custom',
    licenseName: 'Antigravity',
    vendor: 'Antigravity Labs',
    category: 'Diğer',
    requestTitle: 'Quant Analiz Multi-Agent Denemesi',
    reason: 'Google\'ın yeni Antigravity araç setini Quant analiz çalışmalarında denemek istiyorum — multi-agent kod yazımı banka modeli simülasyonlarında değerli olabilir.',
    expectedBenefit: 'Portföy optimizasyon simülasyonlarının kurulum süresinde kısalma; yeni bir araç setinin değerlendirilmesi.',
    successCriteria: 'Multi-agent akışıyla 1 simülasyon senaryosu uçtan uca çalışır halde; karşılaştırmalı değerlendirme raporu.',
    projectType: 'poc',
    estimatedDurationDays: 45,
    dataToUse: 'Açık piyasa verisi (Yahoo Finance) + sentetik portföy verisi.',
    technicalStack: 'Python, NumPy, pandas',
    durationMonths: 3,
    status: 'pending',
    daysAgoCreated: 2,
    reviewTrack: 'swat',
  },
  {
    userEmail: 'elif.celik@klab.test',
    licenseKey: 'jetbrains',
    licenseName: 'JetBrains All',
    vendor: 'JetBrains',
    category: 'IDE',
    requestTitle: 'Veri Pipeline Geliştirme Araçları',
    reason: 'Veri pipeline\'ı (Kafka + Flink) için tüm JetBrains paketine ihtiyacım var — özellikle DataGrip ve IntelliJ Ultimate kombinasyonu Scala/Java jobs için kritik.',
    expectedBenefit: 'Streaming pipeline geliştirme ve hata ayıklama süresinde belirgin azalma; veri kalitesi kontrollerinin hızlanması.',
    successCriteria: 'Pipeline ortalama gecikmesi < 2 sn; data-quality kontrol kapsamı %95\'e çıkmalı.',
    projectType: 'integration',
    estimatedDurationDays: 150,
    dataToUse: 'Kurum içi streaming olay verisi (anonimleştirilmiş, Kafka topic).',
    technicalStack: 'Scala, Java, Apache Kafka, Apache Flink',
    durationMonths: 12,
    status: 'pending',
    daysAgoCreated: 5,
  },
  {
    userEmail: 'naz.yildiz@klab.test',
    licenseKey: 'custom',
    licenseName: 'Figma Organization',
    vendor: 'Figma',
    category: 'Diğer',
    requestTitle: 'Servis Tasarım Ekip Lisansı',
    reason: 'Servis tasarım çalışmaları için ekip lisansı; mevcut Pro plan tek kullanıcı için yetiyor ama 5 kişilik tasarım ekibine ölçeklenmemiz lazım.',
    expectedBenefit: 'Tasarım ekibinin eşzamanlı çalışabilmesi; tasarım–geliştirme devir süresinde kısalma.',
    successCriteria: '5 tasarımcı tek dosyada eşzamanlı çalışabilmeli; tasarım teslim süresi %30 kısalmalı.',
    projectType: 'integration',
    estimatedDurationDays: null,
    dataToUse: 'Veri kullanılmıyor — tasarım iş birliği aracı.',
    technicalStack: null,
    durationMonths: 12,
    status: 'pending',
    daysAgoCreated: 1,
  },

  // Feedback requested (kullanıcı revize etmeli)
  {
    userEmail: 'emre.aksoy@klab.test',
    licenseKey: 'azure',
    licenseName: 'Azure OpenAI',
    vendor: 'Microsoft',
    category: 'Cloud',
    requestTitle: 'DevOps Log Analizi',
    reason: 'DevOps pipeline\'larında AI destekli log analizi için Azure OpenAI istiyorum.',
    expectedBenefit: 'Üretim olaylarında kök neden analiz süresinin kısalması.',
    successCriteria: 'Olay başına ortalama teşhis süresi %40 azalmalı.',
    projectType: 'poc',
    estimatedDurationDays: 60,
    dataToUse: 'Kurum içi sistem log\'ları (PII içermeyen, maskelenmiş).',
    technicalStack: 'Python, Azure SDK',
    durationMonths: 12,
    status: 'feedback_requested',
    adminFeedback: 'Azure OpenAI lisansı yüksek bütçeli — KVKK uyumluluk, veri lokasyonu ve maliyet projeksiyonu (3-6-12 ay) içeren detaylı bir gerekçe paylaşır mısın? Türkiye region kullanılabiliyor mu?',
    daysAgoCreated: 10,
    usesExternalApi: true,
  },
  {
    userEmail: 'onur.acar@klab.test',
    licenseKey: 'openai',
    licenseName: 'OpenAI API',
    vendor: 'OpenAI',
    category: 'API',
    requestTitle: 'Sözleşme Analizi Otomasyonu',
    reason: 'Açık bankacılık API sözleşmelerini otomatik analiz etmek için OpenAI API kotası istiyorum.',
    expectedBenefit: 'Sözleşme inceleme süresinde belirgin kısalma; manuel okuma yükünün azalması.',
    successCriteria: 'Sözleşme başına inceleme süresi 2 saatten 20 dakikaya inmeli.',
    projectType: 'poc',
    estimatedDurationDays: 45,
    dataToUse: 'Açık bankacılık örnek sözleşmeleri (kamuya açık şablonlar).',
    technicalStack: 'Python, OpenAI SDK',
    durationMonths: 6,
    status: 'feedback_requested',
    adminFeedback: 'Müşteri verisi içerebilecek sözleşmeler için OpenAI yerine Azure OpenAI (enterprise data residency garantili) öneriyoruz. Bu alternatifi de değerlendirip tercihini iletir misin?',
    daysAgoCreated: 7,
    usesExternalApi: true,
  },

  // Rejected
  {
    userEmail: 'mehmet.demir@klab.test',
    licenseKey: 'custom',
    licenseName: 'Midjourney',
    vendor: 'Midjourney Inc.',
    category: 'Diğer',
    requestTitle: 'Pazarlama Görsel Üretimi',
    reason: 'Pazarlama materyali için AI görsel üretici.',
    expectedBenefit: 'Kampanya görseli üretim süresinde kısalma.',
    successCriteria: 'Kampanya başına görsel hazırlık süresi yarıya inmeli.',
    projectType: 'poc',
    estimatedDurationDays: 30,
    dataToUse: 'Veri kullanılmıyor — metinden görsel üretimi.',
    technicalStack: null,
    durationMonths: 3,
    status: 'rejected',
    adminFeedback: 'Marka uyumluluğu açısından Midjourney prompt akışı kurumsal denetime kapalı — mevcut Stable Diffusion + brand-LoRA setup\'ımızı kullanmanı öneriyoruz (Furkan ekibi destek olabilir).',
    daysAgoCreated: 20,
  },
  {
    userEmail: 'begum.kilic@klab.test',
    licenseKey: 'custom',
    licenseName: 'Replit Teams',
    vendor: 'Replit',
    category: 'Diğer',
    requestTitle: 'Hızlı Prototipleme Ortamı',
    reason: 'Hızlı prototipleme için cloud IDE.',
    expectedBenefit: 'Prototip kurulum süresinin kısalması.',
    successCriteria: 'Yeni prototip ortamı 5 dakikada ayağa kalkmalı.',
    projectType: 'poc',
    estimatedDurationDays: 30,
    dataToUse: 'Sentetik test verisi.',
    technicalStack: 'Python, FastAPI',
    durationMonths: 6,
    status: 'rejected',
    adminFeedback: 'Replit cloud üzerinde kod barındırılması bilgi güvenliği politikası gereği uygun değil. Yerel geliştirme için JetBrains veya VSCode tercih edilmeli.',
    daysAgoCreated: 15,
  },
];

/** Onaylı bir proje için yaşam döngüsü verisini (kapı/onay/olay) seed'ler. */
const STAGE_RANK: Record<'development' | 'stage' | 'production' | 'live', number> = {
  development: 1,
  stage: 2,
  production: 3,
  live: 4,
};

/** Bir kapı için gerçekçi demo skoru üretir. */
function demoGateScore(key: GateKey): number | null {
  switch (key) {
    case 'code_review':
      return 70 + Math.floor(Math.random() * 22); // 70-91
    case 'architecture':
      return 85 + Math.floor(Math.random() * 12); // 85-96
    case 'framework':
      return 90 + Math.floor(Math.random() * 9); // 90-98
    default:
      return null; // build / security — geç/kal
  }
}

async function seedLifecycle(
  requestId: string,
  level: GovernanceLevel,
  targetStage: 'development' | 'stage' | 'production' | 'live',
  reviewerId: string | null,
  createdAtMs: number
): Promise<void> {
  const rank = STAGE_RANK[targetStage];
  const nowMs = Date.now();
  const span = Math.max(nowMs - createdAtMs, 4 * 86400_000);
  const stepMs = span / (rank + 1);
  const at = (i: number) => new Date(createdAtMs + stepMs * (i + 1)).toISOString();

  const stages: Array<'application' | 'development' | 'stage' | 'production' | 'live'> = [
    'application',
    'development',
    'stage',
    'production',
    'live',
  ];

  const INSERT_EVENT = `INSERT INTO project_stage_events
       (id, request_id, from_stage, to_stage, actor_id, actor_type, note, created_at)
     VALUES (?, ?, ?, ?, ?, 'admin', ?, ?)`;
  const INSERT_GATE = `INSERT OR IGNORE INTO quality_gates
       (id, request_id, gate_key, status, score, threshold, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const INSERT_APPROVAL = `INSERT INTO human_approvals
       (id, request_id, approval_type, decision, approver_id,
        release_note, risk_assessment, decided_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // Aşama geçiş olayları (application → ... → targetStage)
  const notes: Record<string, string> = {
    development: 'Başvuru onaylandı — geliştirme aşamasına geçildi.',
    stage: 'Tüm kalite kapıları yeşil — Stage aşamasına geçildi.',
    production: 'Stage insan onayı alındı — Production aşamasına geçildi.',
    live: 'Production onayı alındı — proje canlıya alındı.',
  };
  for (let i = 1; i <= rank; i++) {
    await dbRun(INSERT_EVENT, [
      nanoid(),
      requestId,
      stages[i - 1],
      stages[i],
      reviewerId,
      notes[stages[i]] ?? null,
      at(i - 1),
    ]);
  }

  // Kalite kapıları — development'ta karışık, stage+'da hepsi yeşil.
  const gates = applicableGates(level);
  for (let idx = 0; idx < gates.length; idx++) {
    const key = gates[idx];
    let status: 'pending' | 'passed' | 'failed' = 'passed';
    if (rank === 1) {
      // Geliştirme aşaması: son kapı henüz beklemede (panel ilerleme gösterir).
      status = idx >= gates.length - 1 ? 'pending' : 'passed';
    }
    await dbRun(INSERT_GATE, [
      nanoid(),
      requestId,
      key,
      status,
      status === 'passed' ? demoGateScore(key) : null,
      GATE_DEFINITIONS[key].threshold,
      status === 'pending' ? null : at(0),
    ]);
  }

  // İnsan onayları
  if (rank >= STAGE_RANK.stage) {
    const decided = rank >= STAGE_RANK.production;
    await dbRun(INSERT_APPROVAL, [
      nanoid(),
      requestId,
      'stage',
      decided ? 'approved' : 'pending',
      decided ? reviewerId : null,
      decided ? 'Stage ortamı incelendi, smoke testler yeşil.' : null,
      decided ? 'Düşük risk — geri alma planı hazır.' : null,
      decided ? at(1) : null,
      at(1),
    ]);
  }
  if (rank >= STAGE_RANK.production) {
    const decided = rank >= STAGE_RANK.live;
    await dbRun(INSERT_APPROVAL, [
      nanoid(),
      requestId,
      'production',
      decided ? 'approved' : 'pending',
      decided ? reviewerId : null,
      decided ? 'Release notu onaylandı, blue-green dağıtım planlandı.' : null,
      decided ? 'Risk değerlendirmesi tamamlandı.' : null,
      decided ? at(2) : null,
      at(2),
    ]);
  }
}

export async function seedLicenseRequests(): Promise<void> {
  const existing = await dbOne('SELECT COUNT(*) as count FROM license_requests', []) as { count: number };
  if (existing.count > 0) {
    console.log(`[SEED] Lisans talepleri zaten yüklü (${existing.count}), atlanıyor.`);
    return;
  }

  const users = await dbAll('SELECT id, email FROM users', []) as Array<{ id: string; email: string }>;
  const admins = await dbAll('SELECT id FROM admins WHERE role = ?', ['super_admin']) as Array<{ id: string }>;
  const reviewerId = admins[0]?.id ?? null;
  const userByEmail = new Map(users.map((u) => [u.email, u.id]));

  const INSERT_LICENSE = `
    INSERT INTO license_requests (
      id, user_id, license_key, license_name, vendor, category,
      reason, duration_months,
      request_title, expected_benefit, success_criteria,
      project_type, estimated_duration_days, data_to_use, technical_stack,
      uses_external_api, involves_real_data, review_track,
      lifecycle_stage, governance_level, stage_entered_at,
      status, admin_feedback,
      reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const INSERT_LICENSE_ITEM = `
    INSERT INTO license_request_items
      (id, request_id, license_key, license_name, vendor, category, item_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  let count = 0;
  await dbTx(async () => {
    for (const r of LICENSE_REQUESTS) {
      const userId = userByEmail.get(r.userEmail);
      if (!userId) {
        console.warn(`[SEED] Lisans talebi atlandı (user yok): ${r.userEmail}`);
        continue;
      }

      const daysAgo = r.daysAgoCreated ?? 7;
      const createdAtMs = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
      const createdAt = new Date(createdAtMs).toISOString();
      const isReviewed = r.status !== 'pending';
      const reviewedAt = isReviewed
        ? new Date(Date.now() - Math.max(0, daysAgo - 2) * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const level: GovernanceLevel =
        r.projectType === 'integration' ? 'full' : 'basic';
      const targetStage =
        r.status === 'approved' ? (r.targetStage ?? 'development') : null;
      const lifecycleStage = targetStage ?? 'application';
      const stageEnteredAt = targetStage ? reviewedAt : null;

      const id = nanoid();
      await dbRun(INSERT_LICENSE, [
        id,
        userId,
        r.licenseKey,
        r.licenseName,
        r.vendor ?? null,
        r.category ?? null,
        r.reason,
        r.durationMonths,
        r.requestTitle,
        r.expectedBenefit,
        r.successCriteria,
        r.projectType,
        r.estimatedDurationDays ?? null,
        r.dataToUse,
        r.technicalStack ?? null,
        r.usesExternalApi ? 1 : 0,
        r.involvesRealData ? 1 : 0,
        r.reviewTrack ?? 'standard',
        lifecycleStage,
        level,
        stageEnteredAt,
        r.status,
        r.adminFeedback ?? null,
        isReviewed ? reviewerId : null,
        reviewedAt,
        createdAt,
        reviewedAt ?? createdAt,
      ]);

      // license_request_items — birincil araç (item_order 0) + ek araçlar.
      const tools: LicenseToolSeed[] = [
        {
          licenseKey: r.licenseKey,
          licenseName: r.licenseName,
          vendor: r.vendor ?? null,
          category: r.category ?? null,
        },
        ...(r.extraTools ?? []),
      ];
      for (let idx = 0; idx < tools.length; idx++) {
        const t = tools[idx];
        await dbRun(INSERT_LICENSE_ITEM, [
          nanoid(),
          id,
          t.licenseKey,
          t.licenseName,
          t.vendor ?? null,
          t.category ?? null,
          idx,
        ]);
      }

      // Onaylı projeler için yaşam döngüsü (kapı/onay/olay).
      if (targetStage) {
        await seedLifecycle(id, level, targetStage, reviewerId, createdAtMs);
      }

      count++;
    }
  });

  console.log(`[SEED] ${count} lisans talebi eklendi (${LICENSE_REQUESTS.filter((r) => r.status === 'approved').length} approved, ${LICENSE_REQUESTS.filter((r) => r.status === 'pending').length} pending, ${LICENSE_REQUESTS.filter((r) => r.status === 'feedback_requested').length} feedback, ${LICENSE_REQUESTS.filter((r) => r.status === 'rejected').length} rejected).`);
}

/* ============================================================
 * BEKLEME LİSTESİ — demo verisi (öncelik yönetimi için)
 * ============================================================ */

interface WaitlistSeed {
  userEmail: string;
  roomCode: string;
  periodMonths: 1 | 2 | 3;
  projectName: string;
  daysAgoJoined: number;
}

const WAITLIST_ENTRIES: WaitlistSeed[] = [
  // KT-01 odası için sıra (4 kişi)
  { userEmail: 'mehmet.demir@klab.test', roomCode: 'KT-01', periodMonths: 2, projectName: 'Kredi Skorlama Görselleştirme', daysAgoJoined: 12 },
  { userEmail: 'selin.dogan@klab.test', roomCode: 'KT-01', periodMonths: 1, projectName: 'Mobil Onboarding UX Testi', daysAgoJoined: 9 },
  { userEmail: 'emre.aksoy@klab.test', roomCode: 'KT-01', periodMonths: 3, projectName: 'Log Anomali Tespiti', daysAgoJoined: 5 },
  { userEmail: 'begum.kilic@klab.test', roomCode: 'KT-01', periodMonths: 2, projectName: 'API Gateway Prototipi', daysAgoJoined: 2 },
  // KT-04 odası için sıra (3 kişi)
  { userEmail: 'naz.yildiz@klab.test', roomCode: 'KT-04', periodMonths: 1, projectName: 'Servis Yolculuğu Haritası', daysAgoJoined: 8 },
  { userEmail: 'onur.acar@klab.test', roomCode: 'KT-04', periodMonths: 2, projectName: 'Açık Bankacılık Entegrasyon Denemesi', daysAgoJoined: 4 },
  { userEmail: 'defne.arslan@klab.test', roomCode: 'KT-04', periodMonths: 3, projectName: 'Portföy Optimizasyon Simülasyonu', daysAgoJoined: 1 },
];

export async function seedWaitlist(): Promise<void> {
  const existing = await dbOne('SELECT COUNT(*) as count FROM waitlist', []) as { count: number };
  if (existing.count > 0) {
    console.log(`[SEED] Bekleme listesi zaten yüklü (${existing.count}), atlanıyor.`);
    return;
  }

  const users = await dbAll('SELECT id, email FROM users', []) as Array<{ id: string; email: string }>;
  const rooms = await dbAll('SELECT id, code FROM rooms', []) as Array<{ id: string; code: string }>;
  const userByEmail = new Map(users.map((u) => [u.email, u.id]));
  const roomByCode = new Map(rooms.map((r) => [r.code, r.id]));

  const INSERT_WAITLIST = `
    INSERT INTO waitlist (
      id, user_id, room_id, period_months, desired_start_date,
      project_name, project_description, help_needed, technologies,
      position, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)
  `;

  // Oda bazında position sayacı.
  const positionByRoom = new Map<string, number>();
  let count = 0;
  await dbTx(async () => {
    for (const w of WAITLIST_ENTRIES) {
      const userId = userByEmail.get(w.userEmail);
      const roomId = roomByCode.get(resolveRoomCode(w.roomCode));
      if (!userId || !roomId) continue;
      const pos = (positionByRoom.get(roomId) ?? 0) + 1;
      positionByRoom.set(roomId, pos);
      const createdAt = new Date(Date.now() - w.daysAgoJoined * 86400000).toISOString();
      const desiredStart = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      await dbRun(INSERT_WAITLIST, [
        nanoid(),
        userId,
        roomId,
        w.periodMonths,
        desiredStart,
        w.projectName,
        `${w.projectName} için ${resolveRoomCode(w.roomCode)} odasında çalışma talebi.`,
        'Mimari danışmanlık ve model değerlendirme desteği.',
        JSON.stringify(['Python', 'FastAPI']),
        pos,
        createdAt,
        createdAt,
      ]);
      count++;
    }
  });

  console.log(`[SEED] ${count} bekleme listesi kaydı eklendi.`);
}

/* ============================================================
 * BİLDİRİMLER — demo verisi (bildirim merkezi zilini doldurur)
 * ============================================================ */

interface NotificationSeed {
  recipientEmail: string;
  recipientType: 'user' | 'admin';
  category: 'booking' | 'license' | 'waitlist' | 'message' | 'system';
  title: string;
  body: string;
  link?: string | null;
  read?: boolean;
  hoursAgo?: number;
}

const NOTIFICATIONS: NotificationSeed[] = [
  {
    recipientEmail: 'user@klab.test',
    recipientType: 'user',
    category: 'system',
    title: 'AI Lab Randevu Sistemi’ne hoş geldin',
    body: 'Oda kiralama ve lisans başvurularını buradan takip edebilirsin.',
    link: '/rooms',
    read: true,
    hoursAgo: 72,
  },
  {
    recipientEmail: 'user@klab.test',
    recipientType: 'user',
    category: 'booking',
    title: 'Randevu talebin onaylandı',
    body: 'Detaylar için Taleplerim sayfasını aç.',
    link: '/bookings',
    read: false,
    hoursAgo: 26,
  },
  {
    recipientEmail: 'user@klab.test',
    recipientType: 'user',
    category: 'license',
    title: 'Lisans başvurun için düzeltme istendi',
    body: 'Panelinden düzenleyip yeniden gönderebilirsin.',
    link: '/licenses',
    read: false,
    hoursAgo: 5,
  },
  {
    recipientEmail: 'admin@klab.test',
    recipientType: 'admin',
    category: 'license',
    title: 'Yeni lisans başvurusu',
    body: 'Zeynep Kaya — "Risk Modeli İterasyon Ortamı" (Cursor)',
    link: '/admin/licenses',
    read: false,
    hoursAgo: 3,
  },
  {
    recipientEmail: 'admin@klab.test',
    recipientType: 'admin',
    category: 'booking',
    title: 'Yeni randevu talebi geldi',
    body: 'Admin panelinden inceleyebilirsin.',
    link: '/admin',
    read: false,
    hoursAgo: 12,
  },
];

export async function seedNotifications(): Promise<void> {
  const existing = await dbOne('SELECT COUNT(*) as count FROM notifications', []) as {
    count: number;
  };
  if (existing.count > 0) {
    console.log(`[SEED] Bildirimler zaten yüklü (${existing.count}), atlanıyor.`);
    return;
  }

  const users = await dbAll('SELECT id, email FROM users', []) as Array<{
    id: string;
    email: string;
  }>;
  const admins = await dbAll('SELECT id, email FROM admins', []) as Array<{
    id: string;
    email: string;
  }>;
  const idByEmail = new Map<string, string>([
    ...users.map((u) => [u.email, u.id] as const),
    ...admins.map((a) => [a.email, a.id] as const),
  ]);

  const INSERT_NOTIFICATION = `
    INSERT INTO notifications
      (id, recipient_id, recipient_type, category, title, body, link, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  let count = 0;
  for (const n of NOTIFICATIONS) {
    const recipientId = idByEmail.get(n.recipientEmail);
    if (!recipientId) continue;
    const createdAt = new Date(
      Date.now() - (n.hoursAgo ?? 1) * 60 * 60 * 1000
    ).toISOString();
    await dbRun(INSERT_NOTIFICATION, [
      nanoid(),
      recipientId,
      n.recipientType,
      n.category,
      n.title,
      n.body,
      n.link ?? null,
      n.read ? 1 : 0,
      createdAt,
    ]);
    count++;
  }

  console.log(`[SEED] ${count} bildirim eklendi.`);
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

export async function runSeed(): Promise<void> {
  // PROD GUARD: Demo seed bilinen sabit parolalı hesaplar (admin@klab.test vb.)
  // üretir. Üretim DB'sine yanlışlıkla yüklenmesini engelle — bilinçli açmak için
  // ALLOW_PROD_SEED=true gerekir (app_security.md: demo veri prod'a sızmamalı).
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Demo seed production ortamında engellendi. Bilinçli olarak yüklemek için ' +
        'ALLOW_PROD_SEED=true ayarlayın (ve demo hesap parolalarını derhal değiştirin).'
    );
  }
  await seedRooms();
  await seedUsers();
  await seedAdmins();
  await seedBookings();
  await seedShowcaseEngagement();
  await seedLicenseRequests();
  await seedWaitlist();
  await seedNotifications();
  await seedBooks();
}
