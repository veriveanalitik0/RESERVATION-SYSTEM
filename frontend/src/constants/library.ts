/**
 * Kütüphane kategori düzeni — Excel kitap listesindeki pedagojik sıra.
 * UserLibrary (bölümler + çipler) ve AdminLibrary (filtre + sıralama) paylaşır.
 * Listede olmayan kategoriler sona alfabetik eklenir; kategorisiz kitaplar "Diğer"e düşer.
 */
export const CATEGORY_ORDER = [
  'Giriş',
  'Uygulama',
  'LLM & Prompt',
  'Programlama & Temeller',
  'Güvenlik & Ağ',
  'İş & Strateji',
  'Etik & Toplum',
  'İlham',
];

export const OTHER_CATEGORY = 'Diğer';

/** Kategori adını sabit sıraya göre karşılaştırma anahtarına çevirir (bilinmeyenler sona). */
export function categoryRank(cat: string): number {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}
