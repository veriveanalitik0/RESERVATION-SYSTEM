import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollText, ShieldCheck, ChevronDown, LogOut } from 'lucide-react';

/**
 * EK-1: Yapay Zeka Laboratuvarı Kullanımı "Okudum, Kabul Ettim" beyan kartı.
 *
 * Login/Register akışında bir kereye mahsus, formun yerine geçen adım olarak
 * gösterilir (MFA adımıyla aynı desen). Görsel sistem auth ekranlarıyla ortak:
 * glass dark card (bg-black/55 + backdrop-blur) + kt-gold vurgular.
 *
 * Kurumsal onay politikası:
 *  - Metin sonuna kadar kaydırılmadan onay kutusu aktifleşmez (içerik ekrana
 *    sığıyorsa otomatik aktif).
 *  - Onay kutusu işaretlenmeden "Onaylıyorum" butonu devre dışıdır.
 *  - Vazgeçilirse oturum kapatılır — beyan onaylanmadan sisteme girilemez.
 */

const CONSENT_ITEMS = [
  'Laboratuvarı yalnızca AILAB uygulaması üzerinden onaylanan talep kapsamında ve belirtilen amaç doğrultusunda kullanacağımı,',
  'Laboratuvara gerçek Banka verisi, müşteri verisi veya kişisel veri getirmeyeceğimi; çalışmalarımda yalnızca sentetik veya kamuya açık veriler kullanacağımı,',
  'Laboratuvar cihazlarını ve izole ağı, Banka kurumsal sistemlerine erişim amacıyla kullanmayacağımı,',
  'Bana tahsis edilen yapay zeka lisanslarını yalnızca çalışma kapsamında ve amacına uygun kullanacağımı,',
  'Çalışmam süresince laboratuvar ortamındaki faaliyetlerimin izlenebileceğini bildiğimi ve kabul ettiğimi,',
  'Çalışmam tamamlandığında çıkış prosedürünü uygulayacağımı; masa üstü temizliğini yapacağımı, oturumlarımı kapatacağımı ve verinin imhasını gerçekleştireceğimi,',
  'Laboratuvarı amacına uygun olmayan hiçbir şekilde kullanmayacağımı; aykırı kullanım halinde Disiplin Yönetmeliği kapsamındaki kişisel sorumluluğun tarafıma ait olduğunu,',
  'Bu beyandaki taahhütlerin, laboratuvarı kullandığım tüm dönemler için geçerli olduğunu',
];

interface Props {
  /** Beyanı onaylayacak kullanıcının adı — kart başlığında kişiselleştirme. */
  fullName: string;
  loading?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function ConsentCard({ fullName, loading = false, onAccept, onDecline }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const checkScrollEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 24px tolerans — son satıra ulaşıldı sayılır (fraksiyonel piksel + momentum).
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (atEnd) setScrolledToEnd(true);
  }, []);

  // İçerik ekrana sığıyorsa (scroll yok) kaydırma şartı aranmaz. Pencere
  // büyüyüp metin scroll'suz sığar hale gelirse onScroll bir daha TETİKLENMEZ —
  // resize/ResizeObserver ile yeniden değerlendirilir, yoksa onay kutusu
  // kalıcı kilitli kalırdı.
  useEffect(() => {
    checkScrollEnd();
    window.addEventListener('resize', checkScrollEnd);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(checkScrollEnd) : null;
    if (ro && scrollRef.current) ro.observe(scrollRef.current);
    return () => {
      window.removeEventListener('resize', checkScrollEnd);
      ro?.disconnect();
    };
  }, [checkScrollEnd]);

  return (
    <div className="relative p-6 md:p-8 rounded-2xl backdrop-blur-xl bg-black/55 border border-white/10 shadow-2xl animate-fade-in">
      {/* Card glow accents — auth kartlarıyla ortak */}
      <div className="absolute -top-16 -right-16 w-44 h-44 bg-kt-gold-400/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-16 -left-16 w-44 h-44 bg-kt-violet-500/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative">
        {/* Başlık */}
        <div className="flex items-start gap-4 mb-5">
          <div className="w-12 h-12 rounded-xl bg-kt-gold-400/15 border border-kt-gold-400/30 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-kt-gold-300" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-kt-gold-300/90">
              EK-1 · Kullanım Beyanı
            </p>
            <h2 className="text-lg md:text-xl font-extrabold text-white leading-snug mt-0.5">
              Yapay Zeka Laboratuvarı Kullanımı{' '}
              <span className="text-shimmer">&ldquo;Okudum, Kabul Ettim&rdquo;</span> Beyanı
            </h2>
            <p className="text-xs text-white/60 mt-1">
              {fullName}, devam etmeden önce aşağıdaki beyanı okuyup onaylamanız gerekir.
              Bu onay bir kereye mahsus istenir ve kaydedilir.
            </p>
          </div>
        </div>

        {/* Beyan metni — kaydırılabilir bölge */}
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={checkScrollEnd}
            className="max-h-[44vh] md:max-h-[40vh] overflow-y-auto scrollbar-thin rounded-xl bg-white/[0.06] border border-white/10 p-4 md:p-5 space-y-3"
          >
            <p className="text-sm text-white/85 leading-relaxed">
              Yapay Zeka Laboratuvarı İşletimi Uygulama Esası&rsquo;nı okudum. Laboratuvarı
              aşağıdaki şart ve kullanım koşulları çerçevesinde kullanacağımı kabul ve
              taahhüt ederim:
            </p>
            <ol className="space-y-2.5">
              {CONSENT_ITEMS.map((item, i) => (
                <li key={i} className="flex gap-3 text-sm text-white/75 leading-relaxed">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-kt-gold-400/15 border border-kt-gold-400/25 text-kt-gold-300 text-[11px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
            <p className="text-sm font-semibold text-white/90 leading-relaxed">
              kabul ve beyan ederim.
            </p>
          </div>

          {/* Alt fade + kaydırma ipucu — metin sonuna inilmediyse */}
          {!scrolledToEnd && (
            <div className="absolute bottom-0 inset-x-0 rounded-b-xl bg-gradient-to-t from-black/70 to-transparent pt-10 pb-2 flex justify-center pointer-events-none">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-kt-gold-300 bg-black/50 border border-kt-gold-400/25 px-3 py-1 rounded-full">
                <ChevronDown className="w-3.5 h-3.5 animate-bounce" />
                Onaylamak için metni sonuna kadar kaydırın
              </span>
            </div>
          )}
        </div>

        {/* Onay kutusu */}
        <label
          className={`mt-4 flex items-start gap-3 rounded-xl border p-3.5 transition-colors ${
            scrolledToEnd
              ? 'cursor-pointer bg-white/[0.06] border-white/15 hover:border-kt-gold-400/40'
              : 'opacity-50 cursor-not-allowed bg-white/[0.03] border-white/10'
          } ${accepted ? 'border-kt-gold-400/60 bg-kt-gold-400/10' : ''}`}
        >
          <input
            type="checkbox"
            checked={accepted}
            disabled={!scrolledToEnd || loading}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 shrink-0 accent-[#d7a11c] cursor-pointer disabled:cursor-not-allowed"
            style={{ width: 18, height: 18 }}
          />
          <span className="text-sm text-white/85 leading-snug select-none">
            Yukarıdaki <strong className="text-white">EK-1 beyanını okudum</strong>; tüm şart ve
            taahhütleri <strong className="text-white">kabul ve beyan ederim</strong>.
          </span>
        </label>

        {/* Aksiyonlar */}
        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={onAccept}
            disabled={!accepted || loading}
            className="btn-pill-primary btn-pill-md w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="btn-pill-shimmer" />
            <span className="relative z-10 font-semibold inline-flex items-center gap-2">
              <ScrollText className="w-4 h-4" />
              {loading ? 'Kaydediliyor…' : 'Onaylıyorum ve Devam Et'}
            </span>
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-white/60 hover:text-white transition-colors py-2 disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" />
            Kabul etmiyorum — oturumu kapat
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-white/45">
          Onayınız tarih damgasıyla denetim kaydına işlenir · Yapay Zeka Laboratuvarı
          İşletimi Uygulama Esası
        </p>
      </div>
    </div>
  );
}
