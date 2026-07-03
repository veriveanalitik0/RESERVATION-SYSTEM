# Veri Güvenliği Yönetimi — AI Agent Politikası (Vibecoding / AI Destekli Kod Üretimi)

> **Kapsam**: Bu doküman, bankamız bünyesinde AI destekli kod üretim araçlarıyla
> (Claude Code, Cursor, GitHub Copilot, Google Antigravity, OpenAI Codex vb.)
> kod üreten **tüm kurum içi personel** ve AI ajanları için bağlayıcı **veri
> güvenliği** kurallarını tanımlar.
>
> Kurumsal bilgi güvenliğinin diğer alanları (uygulama güvenliği, ağ güvenliği,
> altyapı güvenliği vb.) için ilgili ekipler tarafından yayımlanmış paralel
> agent dokümanları bulunmaktadır; bu doküman yalnızca veri güvenliği yönetimi
> perspektifiyle sınırlıdır.
>
>**Kural Hiyerarşisi**: Bu dosyadaki kurallar **zorunlu** olup aşılamaz. AI
> ajanı, kurallarla çelişen bir istek aldığında kodu **üretmeyi reddeder** ve
> kuralın ihlalini açıkça raporlar.


---

## İçindekiler
1. [Secret / Credential / API Key Yönetimi](#1-secret--credential--api-key-yönetimi)
2. [PII ve Hassas Veri](#2-pii-ve-hassas-veri)
3. [Veritabanı Erişimi](#3-veritabanı-erişimi)
4. [Loglama](#4-loglama)
5. [Şifreleme](#5-şifreleme)
6. [Test ve Geliştirme Verisi](#6-test-ve-geliştirme-verisi)
7. [Dış Servis Çağrıları](#7-dış-servis-çağrıları)
8. [MCP Sunucu Güvenliği](#8-mcp-sunucu-güvenliği)
9. [Yapısal DB Erişimi ve En Az Yetki](#9-yapısal-db-erişimi-ve-en-az-yetki)
10. [Vektör Veritabanı ve RAG Güvenliği](#10-vektör-veritabanı-ve-rag-güvenliği)
11. [Veri Saklama ve Silme](#11-veri-saklama-ve-silme)
12. [AI Aracına Özel Kullanım](#12-ai-aracına-özel-kullanım)


---


## 1. Secret / Credential / API Key Yönetimi


**Kural**: Şifre, connection string, API key, token, sertifika ve private key
bilgileri kod tabanına, repository'ye, log dosyasına, commit mesajına veya AI
sohbet geçmişine **asla** yazılamaz.
- **Secret kaynağı**: Her secret runtime'da şifrelenmiş konfigürasyon veya
  kurumsal kasa (vault) üzerinden çekilir.
- **Repository temizliği**: `.env`, `*.pem`, `secrets.json` gibi dosyalar
  `.gitignore`'a alınır; placeholder değerler `.env.example`'da tutulur.
- **Log ve trace**: Secret'lar structured log'a düşmez.
- **CI/CD**: Pipeline değişkenleri kurumsal vault entegrasyonundan alınır,
  repository'de secret variable tanımlanmaz.
**Yüksek Risk Patterni**:
```csharp
// YASAK — kaynak kodda veya config dosyasında açık
var conn = "Server=db;User=app;Password=S3cret!;Database=core";
```
```csharp
// ZORUNLU — konfigürasyon/vault üzerinden runtime'da
var conn = configuration.GetConnectionString("Core")
    ?? throw new InvalidOperationException("Core connection string missing");
```
**Prompt Veri Minimizasyonu**: AI destekli geliştirme sırasında AI asistanına
gönderilen prompt'lar içine yanlışlıkla API anahtarı, veritabanı şifresi
veya diğer credential'ların sızma riski vardır. Kod içinde veya prompt
geçmişinde hiçbir API key veya kimlik bilgisi (credential) bulunmamalıdır;
bunlar yalnızca Vault gibi güvenli alanlarda yönetilir. Geliştirme sırasında
AI asistanına hassas kurumsal veri değil, yalnızca kod yapısı gönderilir.
**İstisna**: Yoktur. Geliştirme ortamı dahi kurumsal secret kaynağını kullanır.


---


## 2. PII ve Hassas Veri

*(Bu bölüm PII tanımı, maskeleme standardı ve hassasiyet seviyesi için
**otorite kaynak**tır. Diğer bölümler bu bölüme referans verir.)*
**Kural**: PII / hassas veri; üretim, test, log, hata mesajı, prompt,
telemetri, analytics ve dış servis çağrılarında **açık metin olarak
işlenemez**; maskelenir, tokenize edilir veya şifrelenir.
**Hassas Veri Kapsamı**:
- TCKN (11 hane), IBAN (TR + 24 hane), Kart PAN / CVV / expiry (13–19 hane)
- Ad, soyad, anne kızlık soyadı, telefon, e-posta, adres
- Müşteri numarası, hesap numarası, doğum tarihi, doğum yeri
- KVKK kapsamındaki özel nitelikli veriler (sağlık, din, biyometrik, ceza
  mahkûmiyeti, sendika vb.)
**Maskeleme Standardı** (log, UI, export, prompt):
| Veri Tipi | Maskeleme Kuralı | Örnek |
|---|---|---|
| TCKN | İlk 3, son 3 açık; orta 5 maskeli | `123*****901` |
| IBAN | İlk 4, son 4 açık; orta maskeli | `TR33 **** **** **** **** **** 5612` |
| Kart PAN | Son 4 hariç maskeli | `************1234` (PCI-DSS) |
| E-posta | İlk 1 + domain | `a***@domain.com` |
| Telefon | Son 4 hariç maskeli | `+90 5** *** **12` |
| Ad-Soyad | İlk harfler + nokta | `A*** Y****` |
**Hassasiyet Seviyesine Göre Zorunlu Tedbirler**:
PII iki ana hassasiyet seviyesine ayrılır:
- **Genel PII**: ad-soyad, telefon, e-posta, adres, doğum tarihi, müşteri/hesap numarası
- **Kritik PII**: TCKN, IBAN, PAN, CVV, expiry ve KVKK kapsamındaki özel nitelikli kişisel veriler (sağlık, din, biyometrik, ceza mahkûmiyeti vb.)
| Tedbir | Genel PII | Kritik PII |
|---|---|---|
| At-rest şifreleme | AES-256 (anahtar şifreli konfigürasyon veya kasa) | AES-256 (anahtar kurumsal kasa + integrity doğrulaması) |
| In-transit | TLS 1.2+ | TLS 1.3 (önerilir) |
| Maskeleme (log + UI) | Evet | Evet |
**Yüksek Risk Patterni**:
```csharp
// YASAK — PII açık metin log'a düşüyor
_logger.LogInformation("Müşteri: TCKN={Tckn}, IBAN={Iban}", user.Tckn, user.Iban);
```
```csharp
// ZORUNLU — maskeleme helper üzerinden
_logger.LogInformation("Müşteri: TCKN={Tckn}, IBAN={Iban}",
    PiiMasker.MaskTckn(user.Tckn),   // 123*****901
    PiiMasker.MaskIban(user.Iban));
```
```sql
-- YASAK — PAN ham metin saklanıyor
INSERT INTO PaymentTrace (CardNumber, Amount) VALUES ('4539123412341234', 100);
-- ZORUNLU — tokenization service çıktısı saklanır, ham PAN PCI-DSS scope dışı
INSERT INTO PaymentTrace (CardToken, Amount) VALUES (@cardToken, @amount);
```
**İstisna**: PII'nin yetkili kullanıcıya açık metin gösterimi (ör. müşteri
sorgulama ekranı) yalnızca TLS üzerinden ve yetkili ekran akışında mümkündür.

---

## 4. Loglama

**Kural**: Log kayıtlarında secret, credential ve PII yer alamaz. Structured
logging zorunludur; sensitive field'lar log yazılmadan önce scrubber'dan
geçirilir.
- **Scrubber allowlist**: aşağıdaki anahtar kelimeleri içeren alanlar log'a
  yazılmadan `[REDACTED]` ile değiştirilir —
  `password`, `pwd`, `secret`, `token`, `authorization`, `apikey`, `api_key`,
  `tckn`, `iban`, `cardnumber`, `cardno`, `pan`, `cvv`, `cvc`, `ssn`,
  `creditcard`.
- **Exception mesajları**: stack trace'e düşen PII maskelenerek loglanır;
  ham exception `ex.ToString()` doğrudan yazılmaz.
- **Log injection**: kullanıcı girdisi log'a yazılırken `\n`, `\r` ve ANSI
  escape karakterleri temizlenir.
- **Request/response body**: ham body log'a düşmez; scrubber'dan geçirilir.
**Log Retention**:
| Log Türü | Saklama Süresi | Dayanak |
|---|---|---|
| Uygulama logu | 90 gün | Kurumsal |
| Erişim / authentication logu | 2 yıl | BDDK BSY |
| DAM / veri erişim logu | 5 yıl | KVKK + BDDK |
| PCI scope logu | 1 yıl online + 3 ay | PCI-DSS |
**Yüksek Risk Patterni**:
```csharp
// YASAK — credential log'a düşüyor
_logger.LogInformation("Auth attempt with password: {Pwd}", request.Password);
// ZORUNLU — field allowlist; password hiç loglanmaz
_logger.LogInformation("Auth attempt for user {UserId}", user.Id);
```
---
## 5. Şifreleme

**Kural**: Tüm ağ trafiği TLS 1.2+ (tercihen 1.3) üzerinden yürür; PII olarak
sınıflanan veriler at-rest olarak AES-256 (veya eşdeğer) ile şifrelenir.
**Algoritma Beyaz Listesi**:
| Amaç | Zorunlu | Yasak |
|---|---|---|
| Hash (password) | Argon2id, bcrypt (cost≥12), PBKDF2-SHA256 (iter≥100k) | MD5, SHA1, düz SHA256 |
| Hash (integrity) | SHA-256, SHA-384, SHA-512 | MD5, SHA1 |
| Simetrik şifreleme | AES-256-GCM, AES-256-CBC + HMAC | DES, 3DES, RC4, ECB mode |
| Asimetrik | RSA ≥ 3072, ECDSA P-256+, Ed25519 | RSA < 2048 |
| TLS | TLS 1.2 (minimum), TLS 1.3 (önerilir) | SSL v3, TLS 1.0, TLS 1.1 |
**Anahtar Yönetimi**: Anahtarlar kod tabanında bulunamaz — şifrelenmiş
konfigürasyon veya kurumsal kasa üzerinden runtime'da çekilir.
**Yüksek Risk Patterni**:
```csharp
// YASAK — MD5 password hash / AES ECB blok paterni sızdırır
var hash = MD5.HashData(Encoding.UTF8.GetBytes(password));
var aes = Aes.Create(); aes.Mode = CipherMode.ECB;
// ZORUNLU — PBKDF2 + AES-GCM (random IV)
var hasher = new PasswordHasher<User>();
user.PasswordHash = hasher.HashPassword(user, password);
using var gcm = new AesGcm(key, tagSizeInBytes: 16);
var iv = RandomNumberGenerator.GetBytes(12);
gcm.Encrypt(iv, plaintext, cipher, tag);
```
---
## 6. Test ve Geliştirme Verisi

**Kural**: Üretim (production) veritabanından dev/test/staging ortamlarına
veri **alınamaz**. Bu kural geliştiriciler, AI ajanları ve **veritabanı
yöneticileri (DBA)** dahil tüm roller için geçerlidir; hangi araç veya
yöntemle olduğuna bakılmaksızın alt ortamlara prod verisi aktarımı yasaktır.
Alt ortamlar yalnızca sentetik (synthetic) veya tokenize/maskelenmiş veri
kullanır.
**Sentetik Veri Standartları**:
- **Sentetik TCKN**: algoritmik olarak geçerli (mod-10 + mod-11) ama gerçek
  bir kişiye ait olmayan.
- **Sentetik IBAN**: TR mod-97 checksum doğru, banka/hesap kombinasyonu
  sentetik aralıkta.
- **Sentetik PAN**: `4000...` (Visa test), `5555...` (Mastercard test) veya
  kurum test BIN'i.
- **Tutar/bakiye**: uniform dağılım; kimlik bilgileriyle korelasyon kırılır.
---
## 7. Dış Servis Çağrıları

**Kural**: Banka ağı dışına giden her HTTP / API çağrısı, egress gateway
(kurumsal proxy) üzerinden ve **domain allowlist** üzerinden geçer.
- **Payload sanitizasyonu**: dışa giden istek gövdesinde PII scrubber
  çalıştırılır.
- **Yurt dışı aktarım**: KVKK kapsamında; Kurul izni ve/veya açık rıza
  zinciri olmadan PII ve bankacılık sırrı aktarılamaz.
- **DPA zorunluluğu**: müşteri verisi işleyen dış servis için Veri İşleme
  Sözleşmesi (DPA) olmadan entegrasyon kurulamaz.
- **Response loglama**: dönüş gövdesi log'a düşerken scrubber'dan geçer.
**Yüksek Risk Patterni**:
```csharp
// YASAK — AI servisine açık müşteri verisi
await httpClient.PostAsync("https://api.openai.com/v1/chat/completions",
    JsonContent.Create(new { messages = new[] {
        new { role = "user", content = $"Müşteri: {customer.Name}, TCKN: {customer.Tckn}" }
    }}));
```
```csharp
// ZORUNLU — PII scrub + kurumsal AI gateway (DPA'lı)
var sanitizedPrompt = PiiScrubber.Scrub(userPrompt);
var response = await _aiGateway.CompleteAsync(sanitizedPrompt);
```
---

## 8. MCP Sunucu Güvenliği
**Kural**: MCP sunucuları birden fazla servisin kimlik doğrulama
token'larını merkezi olarak barındırır; tek sunucu ele geçirildiğinde
bağlı tüm servislere erişim sağlanabilir. Bu nedenle MCP sunucuları
*yüksek değerli varlık* olarak yönetilir ve yalnızca kurumsal
allowlist'teki sunucular çalıştırılabilir.
**Bilinen Tehditler**: token merkezileşmesi, indirect prompt injection,
tool/schema poisoning, confused deputy, RCE via STDIO, shadow MCP
sunucuları, typosquatting (marketplace'lerde benzer isimli kötü amaçlı
sunucular).
**Onay ve Bütünlük**: MCP sunucu kurulumu öncesinde kaynak doğrulama
(kod imzalama), bağımlılık taraması (SCA, hash pin), yetki kapsamı
değerlendirmesi ve veri işleme şartları incelemesi yapılır. Onaysız
MCP sunucusu kurulumu yasaktır; shadow örnekler periyodik taramayla
tespit edilir ve derhal kapatılır.
**Erişim / Yetki**: MCP sunucularına yalnızca görevin gerektirdiği
minimum servis erişimi tanınır. OAuth token'ları kısa ömürlü, vault'ta
saklanır (açık metin konfigürasyon yasak), periyodik rotate edilir.
Kritik işlemler (yazma, silme, dış gönderim) kullanıcı onayı olmadan
çalıştırılmaz. MCP sunucuları private IP aralıklarına ve metadata
endpoint'lerine erişemez; SSRF koruması uygulanır.
**İzleme**: tüm araç çağrıları loglanır (araç adı, parametreler,
kullanıcı, zaman, başarı/hata). Anormal kalıplar (beklenmedik çağrı,
yüksek frekans, yetki dışı girişim) için otomatik alarm kurulur.
Konfigürasyonlar Git'te tutulur; değişiklik onay ve denetim izine
tabidir. Periyodik güvenlik testleri (tool poisoning simülasyonu,
prompt injection via MCP, STDIO enjeksiyonu) zorunludur.

---

## 9. Yapısal DB Erişimi ve En Az Yetki
**Kural**: Uygulamanın veritabanına eriştiği servis hesabı yalnızca görevini
yerine getirmek için gereken **minimum yetkiye** sahip olmalıdır.
`sa`, `root`, `admin`, `dbo` hesapları runtime'da kullanılamaz. Yeni bir
tablo, şema veya yetki ihtiyacı için **Veri Erişim Onay** süreci
(structural DB erişim onayı) takip edilir.

---

## 10. Vektör Veritabanı ve RAG Güvenliği

**Kural**: Embedding'ler, türetildikleri kaynak veriyle **aynı hassasiyet
sınıfında** işlenir. "Embedding anonimdir" varsayımı kabul edilmez;
embedding inversion ile orijinal metnin geri çıkarılması kanıtlanmış
bir saldırı vektörüdür. Kısıtlı veriden üretilen embedding → Kısıtlı;
kaynak verinin tabi olduğu tüm kontroller (şifreleme, erişim kısıtı,
retention, silme yükümlülüğü) embedding'e de uygulanır.

**Embedding Öncesi Hazırlık**:
- PII, credential, dahili URL embedding öncesinde kalıcı olarak
 maskelenir veya çıkarılır; redaksiyon atlanarak embedding üretilemez.
- Metadata alanları minimumda tutulur; tam doküman metni payload olarak
 saklanmaz. Schema doğrulaması ile sızan hassas bilgi yakalanır.
- Üretilen vektörlere kaynak verinin hassasiyet etiketi otomatik
 atanır; etiketsiz vektör yüklenemez.

**Erişim Kontrolü**:
- Rol bazlı ayrım zorunludur: *ingestion writer* (yalnızca yükleme),
 *read-only RAG service* (yalnızca sorgu), *index maintainer*,
 *security auditor*. Tek hesapla hem yazma hem okuma yapılamaz.
- API anahtarları kısa ömürlü, periyodik rotate. Multi-tenant
 ortamlarda namespace izolasyonu; çapraz sorgu varsayılan kapalı.

**Şifreleme**: at-rest AES-256 (anahtar ayrı KMS'te), in-transit
TLS 1.2+, yedekler şifreli ve erişim üretimden bağımsız.

**RAG Pipeline**: veri besleme yalnızca doğrulanmış kaynaklardan;
sorgu sonuçları yetki bazlı filtrelenir; prompt injection via
retrieval riskine karşı besleme aşamasında içerik taraması yapılır;
anormal sorgu kalıplarına rate-limiting uygulanır.

**RAG Yetki Kontrolleri**: Kullanıcının yalnızca yetkili olduğu
dökümanlara erişebildiğini sağlayan RBAC/ABAC yapısı uygulanır.
Guardrail yapılandırması ile prompt injection ve veri sızıntısını
engelleyen LLM Guardrails kullanılır.

**Vektör DB Denetimi**: Embedding'lerin şifrelendiği ve VectorDB
erişimlerinin loglandığı doğrulanır. Kullanılan veritabanı servisine
göre audit mekanizması kurulur; geleneksel DAM yapısı bunu
desteklemiyorsa agentless yapıya geçişle bu ortam sağlanır.

**Envanter / Yaşam Döngüsü**: tüm vektör veritabanları (üretim, test,
PoC) kurumsal envantere kaydedilir. Embedding retention kaynak verinin
süresini aşamaz; KVKK silme talepleri embedding'lere de uygulanır.
Terk edilen projelerin depoları silinir, shadow kullanım periyodik
taramayla tespit edilir. Periyodik güvenlik testleri (embedding
inversion, data poisoning, RAG sızma testi) zorunludur.

---

## 11. Veri Saklama ve Silme

**Kural**: Her veri kategorisi için kurumsal retention politikasında
tanımlanmış **saklama süresi (retention period)** vardır; süre dolduğunda
veri otomatik silinir, anonimleştirilir veya yok edilir.

**Silme / Anonimleştirme Modları**:
- **Hard delete**: satır fiziksel silinir. Log/audit için uygun değil.
- **Soft delete**: `Status = 3` (mantıksal silme). Master data (müşteri,
  hesap) için; unique index'ler `WHERE Status != 3` filtresiyle.
- **Anonymize**: kimlik alanları rastgele/null'lanır; istatistik değeri
  korunur. Analitik veri için tercih edilir.
---
## 12. AI Aracına Özel Kullanım

**Kural**: AI destekli kod üretim araçlarının kullanımı bu bölümdeki
kurallara tabidir. AI ajanı, kurallarla çelişen istek aldığında talebi
reddeder ve gerekçesini açıklar.

### 12.1 Prompt / Sohbet İçeriği
Gerçek müşteri verisi, bankacılık sırrı, credential veya PII, AI aracının
prompt penceresine, sohbet geçmişine, kod yorumuna veya commit mesajına
yapıştırılamaz.

```
// YASAK — Cursor sohbet penceresi
"Şu TCKN'leri doğrulayan fonksiyon yaz: 12345678901, 98765432109"
"Production stack trace'ini analiz et: [müşteri kimliğiyle]"
// ZORUNLU
"TCKN algoritmik doğrulama fonksiyonu yaz. Test için sentetik örnek kullan."
"Şu hata paternini analiz et: [PII scrub edilmiş stack trace]"

```
### 12.2 Üretilen Kodun Doğrulanması

AI tarafından üretilen kod **review'sız merge edilemez**. En az 1 insan
reviewer onayı + CI/CD (SAST, secret scan, dependency scan, unit test)
geçişi zorunludur. AI'ın halüsine ettiği kütüphane / API imzaları, yarım bırakılmış
`TODO`/`FIXME`/`HACK` yer tutucuları özellikle aranır.
**Tehdit Modelleme**: AI tarafından üretilen kritik fonksiyonlar (yetkilendirme,
veri işleme, kimlik doğrulama, kriptografik işlemler vb.) bir insan geliştirici
tarafından **manuel olarak** incelenmeli ve tehdit modelleme (threat modelling)
aşamasından geçirilmelidir. İnsan-denetimi, AI destekli geliştirmede kritik
bir güvenlik katmanıdır; özellikle güvenlik, erişim kontrolü ve veri işleme
akışlarını içeren kod bloklarında bu adım atlanamaz.

### 12.3 Bağımlılık Önerileri

AI bir paket / kütüphane eklemeyi önerdiğinde: kütüphanenin varlığı, bakım
durumu, CVE geçmişi ve lisansı doğrulanır. Halüsine edilmiş paketler
tedarik zinciri saldırısına (typosquatting) açıktır. Doğrulanmadan
`npm install` / `pip install` / `dotnet add package` çalıştırılamaz.
**Yasal ve Lisans Uyumluluğu**: AI'ın ürettiği kod bloklarının telif hakları
ve lisans durumu belirsizlik yaratabilir. AI tarafından önerilen kod
parçacıklarının veya kütüphanelerin kurumun ticari kullanım politikalarına
(Apache 2.0, MIT, BSD vb.) uygunluğu doğrulanır. Copyleft (GPL, AGPL vb.)
lisanslı bağımlılıkların kurumsal yazılıma bulaşma riski değerlendirilir;
uyumsuz lisanslı bileşen production'a alınamaz.

### 12.4 Otomatik Eylem Sınırları

AI ajanının doğrudan production deploy, DB schema değişikliği, credential
rotasyonu, onaysız dış servis çağrısı yapma yetkisi **yoktur**. Bu eylemler
insan onayı ve change management süreci üzerinden yürür.

### 12.5 Sır ve Model Sızıntısı

Kurumsal olmayan AI servislerine (halka açık ChatGPT, Claude.ai web arayüzü
vb.) gönderilen veri, servis tarafından model eğitimine dahil edilebilir.
Bu kanallar üzerinden müşteri verisi, proprietary algoritma / business
logic, iç sistem mimarisi / endpoint listesi / IP planı gönderilemez.
Kurumsal AI gateway bu kısıtı gateway katmanında uygular.

### 12.6 Geliştirme Araçları ve Model Beyanı

Vibecoding sürecinde hangi kod yazıcı araçların kullanıldığı beyan edilir.
Bu, Shadow AI (onaysız AI kullanımı) riskini yönetmek için temeldir.
- **Kullanılan Araçlar**: Kodun üretilmesinde kullanılan IDE eklentileri
 (Cursor, GitHub Copilot vb.) ve modeller (Claude Sonnet, GPT-4o vb.)
 proje dokümantasyonuna kaydedilir.
- **Onay Durumu**: Kullanılan araçların kurumsal Shadow AI politikasına
 uygunluğu ve iş birimi onayı doğrulanır. Onaysız AI aracı ile üretilen
 kod repository'ye kabul edilmez.
- **Kurumsal Envanter**: Tüm AI destekli geliştirme araçları kurumsal
 yazılım envanterinde kayıtlı olmalıdır; kayıtsız araç kullanımı
 periyodik taramayla tespit edilir.
---

## Uyumluluk ve İstisna Süreci

Bu dokümandaki herhangi bir kurala istisna gerektiren durumlar için:
1. Talep sahibi, kuralın hangi maddesinin, hangi gerekçeyle aşılmak
   istendiğini yazılı olarak **Veri Güvenliği Yönetimi** birimine iletir.
2. Risk değerlendirmesi yapılır; kabul edilebilir risk, telafi edici
   kontrol (compensating control) ve süre belirlenir.
3. Onaylanan istisna **dokümante edilir** ve ilgili kod içinde yorum
   satırı ile referans verilir:
```csharp
// [SEC-EXCEPTION-2026-014] Veri Güvenliği Yönetimi onayı — 2027-01-15'e kadar geçerli.
// Sebep: Legacy ERP entegrasyonu AES-128 desteği sadece; migrasyon planı IT-3421.
```
4. Süre sonunda istisna otomatik olarak düşer.

## İletişim

- Veri Güvenliği Ekibi: `veriguvenligiyonetimi@kuveytturk.com.tr`