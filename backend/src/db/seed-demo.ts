/**
 * DEMO seed — YALNIZ yerel geliştirme/deneme içindir.
 *
 * `SEED_DEMO=1` env'i verilmedikçe hiçbir şey yapmaz (bkz. runDemoSeed).
 * Çekirdek prod seed'i (seed.ts) demo veri üretmez ve öyle kalmalıdır — bu
 * dosya onun yerine geçmez, üstüne biner.
 *
 * Üretilen: 19 demo kullanıcı (danışman/ar-ge/izleyici yönetişim rolleriyle),
 * ikinci bir admin ve ~30 örnek rezervasyon (approved/pending/feedback/rejected
 * karışımı, yaşam döngüsü aşamaları dağıtılmış).
 *
 * Parolalar bilinçli olarak zayıf-ama-politikaya-uygun demo parolalarıdır;
 * bu yüzden prod'da ASLA çalıştırılmamalıdır.
 */
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun } from './schema';
import { sqlDateTimeLocal } from '../utils/dates';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
};


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
 * SEED FONKSİYONLARI
 * ============================================================ */

/**
 * Demo kullanıcılar. Idempotent: e-posta çakışması ON CONFLICT DO NOTHING ile
 * yutulur, mevcut kullanıcıların (örn. gerçek kayıtların) üzerine YAZMAZ.
 *
 * consent_accepted_at seed'de doldurulur — demo hesapla girişte EK-1 kartı
 * çıkmasın, hızlı-giriş tek tıkta panele düşsün diye.
 */
export async function seedDemoUsers(): Promise<void> {
  const INSERT_USER = `
    INSERT OR IGNORE INTO users
      (id, email, password_hash, full_name, department, title, manager, bio,
       governance_role, consent_accepted_at, consent_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const now = sqlDateTimeLocal(new Date());
  let n = 0;
  for (const u of DEMO_USERS) {
    const hash = await argon2.hash(u.password, ARGON2_OPTIONS);
    const res = await dbRun(INSERT_USER, [
      nanoid(),
      u.email,
      hash,
      u.fullName,
      u.department ?? null,
      u.title ?? null,
      u.manager ?? null,
      u.bio ?? null,
      u.governanceRole ?? null,
      now,
      'EK-1.v1',
    ]);
    if (res.changes > 0) n++;
  }
  console.log(`[SEED-DEMO] ${n} yeni demo kullanıcı (${DEMO_USERS.length} tanımlı).`);
}

/** İkinci demo admin. Bootstrap admin'i (seed.ts) DEĞİŞTİRMEZ. */
export async function seedDemoAdmins(): Promise<void> {
  const INSERT_ADMIN = `
    INSERT OR IGNORE INTO admins (id, email, password_hash, full_name, role, governance_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  let n = 0;
  for (const a of DEMO_ADMINS) {
    const hash = await argon2.hash(a.password, ARGON2_OPTIONS);
    const res = await dbRun(INSERT_ADMIN, [
      nanoid(),
      a.email,
      hash,
      a.fullName,
      a.role,
      a.governanceRole ?? null,
    ]);
    if (res.changes > 0) n++;
  }
  console.log(`[SEED-DEMO] ${n} yeni demo admin (${DEMO_ADMINS.length} tanımlı).`);
}

/**
 * Örnek rezervasyonlar. Yalnız bookings tablosu BOŞSA çalışır — gerçek
 * rezervasyonların arasına demo kayıt karıştırmamak için.
 */
export async function seedDemoBookings(): Promise<void> {
  const existing = (await dbOne('SELECT COUNT(*) as count FROM bookings', [])) as { count: number };
  if (Number(existing.count) > 0) {
    console.log(`[SEED-DEMO] Booking'ler zaten var (${existing.count}), atlanıyor.`);
    return;
  }

  const users = (await dbAll('SELECT id, email FROM users', [])) as Array<{ id: string; email: string }>;
  const rooms = (await dbAll('SELECT id, code FROM rooms', [])) as Array<{ id: string; code: string }>;
  const admins = (await dbAll('SELECT id FROM admins WHERE role = ?', ['super_admin'])) as Array<{ id: string }>;
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
      console.warn(`[SEED-DEMO] Booking atlandı (user veya oda yok): ${b.projectName}`);
      continue;
    }

    const start = new Date(b.startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + b.periodMonths);
    const endDate = end.toISOString().split('T')[0];

    const isReviewed = b.status !== 'pending';
    const reviewedAt = isReviewed
      ? sqlDateTimeLocal(new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000))
      : null;

    const showcaseVisible = b.status === 'approved' ? 1 : 0;
    const highlight = b.highlight && b.status === 'approved' ? 1 : 0;

    let lifecycleStage = 'application';
    let stageEnteredAt = '';
    if (b.status === 'approved') {
      lifecycleStage = b.lifecycleStage ?? APPROVED_STAGE_CYCLE[approvedIdx % APPROVED_STAGE_CYCLE.length];
      approvedIdx++;
      stageEnteredAt = reviewedAt ?? sqlDateTimeLocal(new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000));
    }

    const createdAt = sqlDateTimeLocal(new Date(start.getTime() - 3 * 24 * 60 * 60 * 1000));
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
      createdAt,
      reviewedAt ?? createdAt,
    ]);
    inserted++;
  }

  console.log(`[SEED-DEMO] ${inserted} booking eklendi.`);
}

/**
 * Demo seed girişi. SEED_DEMO=1 (veya true) yoksa NO-OP — prod'da yanlışlıkla
 * çalışmasın diye guard burada, çağıranda değil.
 */
export async function runDemoSeed(): Promise<boolean> {
  const flag = (process.env.SEED_DEMO ?? '').toLowerCase();
  if (flag !== '1' && flag !== 'true') return false;
  if (process.env.NODE_ENV === 'production') {
    console.warn('[SEED-DEMO] NODE_ENV=production — demo seed ÇALIŞTIRILMADI.');
    return false;
  }
  console.log('[SEED-DEMO] SEED_DEMO aktif — demo veri yükleniyor…');
  await seedDemoUsers();
  await seedDemoAdmins();
  await seedDemoBookings();
  return true;
}
