/**
 * Lisanslarım sayfası — AI Lab proje başvurusu + yönetişim yaşam döngüsü.
 *
 * Başvuru Formu (SADELEŞTİRİLMİŞ — yalnızca çekirdek/zorunlu alanlar):
 *  1. Talep Adı (ad) / Kullanım Amacı (amaç)
 *  2. AI Araç / Lisans Talebi — araç (çoklu)
 *  3. Lisans kullanım süresi
 *
 * Eski opsiyonel alanlar (beklenen fayda, başarı kriteri, proje türü, kullanılacak
 * veri, dış API, gerçek veri beyanı, teknik yığın, tahmini süre) formdan kaldırıldı;
 * geçmiş başvurularda doluysa salt-okunur gösterilir.
 *
 * Onaylanan başvuru bir "proje"ye dönüşür ve yaşam döngüsünü
 * (development → stage → production → live) izler.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { api } from '../services/api';
import type {
  GovernanceBundle,
  LicenseRequest,
  LicenseRequestStatus,
  ProjectType,
} from '../types';
import { QualityGatesPanel } from '../components/governance/QualityGatesPanel';
import { ApprovalsPanel } from '../components/governance/ApprovalsPanel';
import { SecurityRulesCard } from '../components/governance/SecurityRulesCard';
import { SlaBadge } from '../components/governance/SlaBadge';

interface CatalogItem {
  key: string;
  name: string;
  vendor: string;
  category: string;
  tier: 'paid' | 'free' | 'enterprise';
  monthlyUsd: number;
}

interface SelectedItem {
  uid: string;
  isCustom: boolean;
  catalogKey?: string;
  name: string;
  vendor: string | null;
  category: string | null;
}

const DURATION_OPTIONS: Array<{ value: 1 | 3 | 6 | 12; label: string }> = [
  { value: 1, label: '1 ay' },
  { value: 3, label: '3 ay' },
  { value: 6, label: '6 ay' },
  { value: 12, label: '1 yıl' },
];

function statusBadge(status: LicenseRequestStatus) {
  switch (status) {
    case 'pending':
      return { label: 'Beklemede', cls: 'badge-pending' };
    case 'approved':
      return { label: 'Onaylandı', cls: 'badge-approved' };
    case 'rejected':
      return { label: 'Reddedildi', cls: 'badge-rejected' };
    case 'feedback_requested':
      return { label: 'Revize İsteniyor', cls: 'badge-feedback' };
  }
}

function projectTypeLabel(t: ProjectType | null): string | null {
  if (t === 'poc') return 'Deneysel (PoC)';
  if (t === 'integration') return 'Kuruma Entegre';
  return null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function nextUid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function UserLicenses() {
  const toast = useToast();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [requests, setRequests] = useState<LicenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Eksik-alan uyarıları yalnızca kullanıcı bir kez "Gönder"e bastıktan sonra
  // görünür. Aksi halde form ilk açıldığında veya başarılı gönderim sonrası
  // resetForm() formu boşalttığında tüm "en az X karakter" uyarıları haksız
  // yere çıkıyordu ("talep gitse bile uyarı çıkıyor").
  const [triedSubmit, setTriedSubmit] = useState(false);

  // Form state — Sadeleştirilmiş Başvuru Formu (ad / amaç / araç / süre)
  const [requestTitle, setRequestTitle] = useState('');
  const [reason, setReason] = useState(''); // Kullanım Amacı
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [catalogPick, setCatalogPick] = useState<string>('');
  const [customName, setCustomName] = useState('');
  const [customVendor, setCustomVendor] = useState('');
  const [durationMonths, setDurationMonths] = useState<1 | 3 | 6 | 12>(3);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Yönetişim detayı — açık olan başvuru + bundle önbelleği
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<Record<string, GovernanceBundle>>({});
  const [bundleLoading, setBundleLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, mineRes] = await Promise.all([
        api.licenseCatalog(),
        api.listMyLicenseRequests(),
      ]);
      setCatalog(catRes.items);
      setRequests(mineRes.items);
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleDetail(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!bundles[id]) {
      setBundleLoading(true);
      try {
        const bundle = await api.userLicenseRequestDetail(id);
        setBundles((prev) => ({ ...prev, [id]: bundle }));
      } catch (err) {
        toast.push('error', (err as Error).message);
        setExpandedId(null);
      } finally {
        setBundleLoading(false);
      }
    }
  }

  function addCatalogItem() {
    if (!catalogPick) return;
    const item = catalog.find((c) => c.key === catalogPick);
    if (!item) return;
    if (selectedItems.some((s) => !s.isCustom && s.catalogKey === item.key)) {
      toast.push('error', 'Bu araç zaten listede.');
      return;
    }
    setSelectedItems((prev) => [
      ...prev,
      {
        uid: nextUid(),
        isCustom: false,
        catalogKey: item.key,
        name: item.name,
        vendor: item.vendor,
        category: item.category,
      },
    ]);
    setCatalogPick('');
  }

  function addCustomItem() {
    const name = customName.trim();
    if (name.length < 2) {
      toast.push('error', 'Yazılım adı en az 2 karakter olmalı.');
      return;
    }
    if (selectedItems.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      toast.push('error', 'Bu yazılım zaten listede.');
      return;
    }
    setSelectedItems((prev) => [
      ...prev,
      {
        uid: nextUid(),
        isCustom: true,
        name,
        vendor: customVendor.trim() || null,
        category: 'Diğer',
      },
    ]);
    setCustomName('');
    setCustomVendor('');
  }

  function removeItem(uid: string) {
    setSelectedItems((prev) => prev.filter((s) => s.uid !== uid));
  }

  // Eksik zorunlu alanlar — tek kaynak: hem buton durumu hem kullanıcıya gösterilen
  // liste bundan türer (kullanıcı "neden gönderilmiyor" sorusunu yaşamasın).
  // Sadeleştirilmiş form: yalnızca ad / amaç / araç zorunlu (süre her zaman seçili).
  const missingFields: string[] = [];
  if (requestTitle.trim().length < 5) missingFields.push('Talep adı (en az 5 karakter)');
  if (reason.trim().length < 20) missingFields.push('Kullanım amacı (en az 20 karakter)');
  if (selectedItems.length < 1) missingFields.push('En az bir araç/lisans ekleyin');
  const canSubmit = missingFields.length === 0;

  function resetForm() {
    setEditingId(null);
    setTriedSubmit(false);
    setRequestTitle('');
    setReason('');
    setSelectedItems([]);
    setCatalogPick('');
    setCustomName('');
    setCustomVendor('');
    setDurationMonths(3);
  }

  /** Bir başvuruyu forma yükleyip düzenleme moduna geçer. */
  function startEdit(r: LicenseRequest) {
    setEditingId(r.id);
    setRequestTitle(r.requestTitle ?? '');
    setReason(r.reason);
    const sourceItems =
      r.items.length > 0
        ? r.items
        : [{ licenseKey: r.licenseKey, licenseName: r.licenseName, vendor: r.vendor, category: r.category }];
    setSelectedItems(
      sourceItems.map((it) => ({
        uid: nextUid(),
        isCustom: it.licenseKey === 'custom',
        catalogKey: it.licenseKey === 'custom' ? undefined : it.licenseKey,
        name: it.licenseName,
        vendor: it.vendor,
        category: it.category,
      }))
    );
    setCatalogPick('');
    setCustomName('');
    setCustomVendor('');
    setDurationMonths(r.durationMonths);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setTriedSubmit(true);
    if (!canSubmit) {
      toast.push('error', `Eksik alan: ${missingFields.join(' · ')}`);
      return;
    }
    setSubmitting(true);
    try {
      // Sadeleştirilmiş payload — yalnızca çekirdek alanlar (ad/amaç/araç/süre).
      const payload = {
        requestTitle: requestTitle.trim(),
        reason: reason.trim(),
        items: selectedItems.map((s) => ({
          licenseKey: s.isCustom ? 'custom' : (s.catalogKey ?? 'custom'),
          licenseName: s.name,
          vendor: s.vendor,
          category: s.category,
        })),
        durationMonths,
      };
      if (editingId) {
        await api.updateLicenseRequest(editingId, payload);
        toast.push('success', 'Başvurun güncellendi ve yeniden değerlendirmeye gönderildi.');
      } else {
        await api.createLicenseRequest(payload);
        toast.push('success', 'Başvurun admin onayına gönderildi.');
      }
      resetForm();
      setBundles({});
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Sort: pending/feedback önce, sonra approved, sonra rejected
  const sortedRequests = useMemo(() => {
    const order = { pending: 0, feedback_requested: 1, approved: 2, rejected: 3 } as const;
    return [...requests].sort((a, b) => {
      const dx = order[a.status] - order[b.status];
      if (dx !== 0) return dx;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [requests]);

  return (
    <AppShell kind="user">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <header className="mb-8">
          <div className="text-xs uppercase tracking-widest text-kt-gold-700 font-bold mb-2">
            AI Lab Başvuru
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-kt-green-900 mb-2">
            Lisanslarım
          </h1>
          <p className="text-kt-gray-600">
            Yapay zeka proje başvurunu gönder. Onaylanan başvurular bir yönetişim
            yaşam döngüsünden (Geliştirme → Stage → Production → Canlı) geçer.
          </p>
        </header>

        {/* ============ FORM ============ */}
        <section className={`card p-6 md:p-8 mb-10 ${editingId ? 'ring-2 ring-kt-gold-400' : ''}`}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-xl font-bold text-kt-green-900">
              {editingId ? 'Başvuruyu düzenle' : 'Yeni başvuru'}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                disabled={submitting}
                className="text-sm font-semibold text-kt-gray-500 hover:text-red-600 transition-colors"
              >
                Vazgeç
              </button>
            )}
          </div>
          <p className="text-sm text-kt-gray-500 mb-5">
            {editingId
              ? 'Değişikliklerini kaydet — başvuru yeniden admin değerlendirmesine girer.'
              : 'Aşağıdaki alanları eksiksiz doldur — değerlendirme bu bilgilere göre yapılır.'}
          </p>

          <div className="mb-6">
            <SecurityRulesCard />
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* ============ 1) Genel ============ */}
            <fieldset className="space-y-5">
              <legend className="text-sm font-bold uppercase tracking-wider text-kt-green-800 mb-2">
                1) Genel
              </legend>

              <div>
                <label htmlFor="request-title" className="label">
                  Talep Adı <span className="text-red-500">*</span>
                  <span className="text-xs text-kt-gray-400 font-normal ml-2">
                    ({requestTitle.trim().length}/120, min 5)
                  </span>
                </label>
                <input
                  id="request-title"
                  type="text"
                  className="input"
                  placeholder="Örn. Müşteri Şikayet Sınıflandırma Modeli"
                  value={requestTitle}
                  onChange={(e) => setRequestTitle(e.target.value)}
                  maxLength={120}
                  disabled={submitting}
                  required
                />
                <p className="text-xs text-kt-gray-500 mt-1">
                  Projeyi özetleyen kısa ve açıklayıcı başlık.
                </p>
              </div>

              <div>
                <label htmlFor="reason" className="label">
                  Kullanım Amacı <span className="text-red-500">*</span>
                  <span className="text-xs text-kt-gray-400 font-normal ml-2">
                    ({reason.trim().length}/1000, min 20)
                  </span>
                </label>
                <textarea
                  id="reason"
                  className="textarea"
                  placeholder="Projenin çözdüğü iş problemi veya araştırma sorusu."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  disabled={submitting}
                  required
                />
              </div>
            </fieldset>

            {/* ============ 2) AI Araç / Lisans (çoklu) ============ */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-bold uppercase tracking-wider text-kt-green-800 mb-2">
                2) AI Araç / Lisans Talebi <span className="text-red-500">*</span>
              </legend>
              <p className="text-xs text-kt-gray-500 -mt-1">
                Kullanılmak istenen araçlar (Cursor, Copilot, Claude, GPT-4 vb.).
                Birden fazla ekleyebilirsin.
              </p>

              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  className="input flex-1"
                  value={catalogPick}
                  onChange={(e) => setCatalogPick(e.target.value)}
                  disabled={submitting || loading}
                  aria-label="Katalogdan AI aracı seç"
                >
                  <option value="">— Katalogdan seç —</option>
                  {catalog.map((c) => (
                    <option
                      key={c.key}
                      value={c.key}
                      disabled={selectedItems.some((s) => !s.isCustom && s.catalogKey === c.key)}
                    >
                      {c.name} · {c.vendor} · ${c.monthlyUsd}/ay
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addCatalogItem}
                  disabled={submitting || !catalogPick}
                  className="btn-secondary whitespace-nowrap"
                >
                  + Ekle
                </button>
              </div>

              <div className="rounded-xl bg-kt-gray-50 border border-kt-gray-200 p-3">
                <div className="text-xs font-semibold text-kt-gray-600 mb-2">
                  Katalogda yoksa elle ekle:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[2fr_1.5fr_auto] gap-2">
                  <input
                    type="text"
                    className="input"
                    placeholder="Yazılım adı (örn. Replit)"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    maxLength={80}
                    disabled={submitting}
                  />
                  <input
                    type="text"
                    className="input"
                    placeholder="Sağlayıcı (opsiyonel)"
                    value={customVendor}
                    onChange={(e) => setCustomVendor(e.target.value)}
                    maxLength={60}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={addCustomItem}
                    disabled={submitting || customName.trim().length < 2}
                    className="btn-secondary whitespace-nowrap"
                  >
                    + Ekle
                  </button>
                </div>
              </div>

              {selectedItems.length === 0 ? (
                <div className="text-sm text-kt-gray-500 italic">Henüz araç eklenmedi.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selectedItems.map((s) => (
                    <span
                      key={s.uid}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-kt-green-50 border border-kt-green-200 text-sm text-kt-green-900"
                    >
                      <span className="font-semibold">{s.name}</span>
                      {s.vendor && (
                        <span className="text-xs text-kt-green-700 opacity-80">· {s.vendor}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(s.uid)}
                        disabled={submitting}
                        className="ml-1 w-4 h-4 rounded-full bg-kt-green-200 hover:bg-red-200 text-kt-green-900 hover:text-red-900 flex items-center justify-center text-xs font-bold transition-colors"
                        aria-label={`${s.name} kaldır`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </fieldset>

            {/* ============ 5) Lisans Süresi ============ */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-bold uppercase tracking-wider text-kt-green-800 mb-2">
                3) Lisans Kullanım Süresi
              </legend>
              <div>
                <div className="label">
                  Süre <span className="text-red-500">*</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDurationMonths(opt.value)}
                      disabled={submitting}
                      className={`px-4 py-2 rounded-xl font-semibold text-sm transition-colors border ${
                        durationMonths === opt.value
                          ? 'bg-kt-green-600 text-white border-kt-green-600 shadow-kt-green'
                          : 'bg-white text-kt-green-800 border-kt-gray-200 hover:border-kt-green-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-kt-gray-500 mt-2">
                  Talep edilen lisanslar için kullanım periyodu.
                </p>
              </div>
            </fieldset>

            {/* Eksik alanlar — yalnızca bir gönderim denemesinden sonra ve hâlâ
                eksik alan varken gösterilir (boş formda / başarılı gönderim
                sonrası haksız uyarı çıkmasın). */}
            {triedSubmit && !canSubmit && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-900 mb-1.5 flex items-center gap-1.5">
                  <span aria-hidden>⚠️</span> Göndermeden önce şu alanları tamamla:
                </p>
                <ul className="text-sm text-amber-800 space-y-0.5 list-disc list-inside">
                  {missingFields.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2 border-t border-kt-gray-100">
              {editingId && (
                <button type="button" onClick={cancelEdit} disabled={submitting} className="btn-ghost">
                  Vazgeç
                </button>
              )}
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting
                  ? 'Gönderiliyor…'
                  : editingId
                    ? 'Güncelle ve Yeniden Gönder'
                    : 'Başvuruyu Gönder'}
              </button>
            </div>
          </form>
        </section>

        {/* ============ BAŞVURULARIM ============ */}
        <section>
          <h2 className="text-xl font-bold text-kt-green-900 mb-4">
            Başvurularım
            {!loading && requests.length > 0 && (
              <span className="ml-2 text-sm text-kt-gray-500 font-normal">
                ({requests.length})
              </span>
            )}
          </h2>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card p-5 animate-pulse h-28" />
              ))}
            </div>
          ) : sortedRequests.length === 0 ? (
            <div className="card p-8 text-center text-kt-gray-500">
              Henüz bir başvurun yok. Yukarıdaki formdan ilkini gönderebilirsin.
            </div>
          ) : (
            <div className="space-y-3">
              {sortedRequests.map((r) => {
                const badge = statusBadge(r.status);
                const title = r.requestTitle ?? r.licenseName;
                const itemsList = r.items.length > 0
                  ? r.items
                  : [{ licenseName: r.licenseName, vendor: r.vendor, licenseKey: r.licenseKey, category: r.category }];
                const isProject = r.status === 'approved';
                const expanded = expandedId === r.id;
                const bundle = bundles[r.id];
                return (
                  <div key={r.id} className="card p-5">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-lg font-bold text-kt-green-900">{title}</div>
                        <div className="text-xs text-kt-gray-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                          <span>
                            {DURATION_OPTIONS.find((d) => d.value === r.durationMonths)?.label}
                          </span>
                          <span>· Talep tarihi: {fmtDate(r.createdAt)}</span>
                          {r.projectType && <span>· {projectTypeLabel(r.projectType)}</span>}
                          {r.estimatedDurationDays && (
                            <span>· Tahmini {r.estimatedDurationDays} gün</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={badge.cls}>{badge.label}</span>
                        {r.reviewTrack === 'swat' && r.status === 'pending' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-kt-violet-100 text-kt-violet-700 border-kt-violet-300">
                            SWAT İncelemesi
                          </span>
                        )}
                        <SlaBadge sla={r.sla} />
                      </div>
                    </div>

                    {/* Araç chip'leri */}
                    <div className="flex flex-wrap gap-1.5 mt-2 mb-3">
                      {itemsList.map((it, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-0.5 rounded-full bg-kt-green-50 border border-kt-green-200 text-kt-green-800"
                        >
                          {it.licenseName}
                          {it.vendor && <span className="opacity-70"> · {it.vendor}</span>}
                        </span>
                      ))}
                    </div>

                    {/* Form alanları */}
                    <div className="space-y-2 text-sm text-kt-gray-700">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                          Kullanım Amacı
                        </div>
                        <p className="leading-relaxed whitespace-pre-line">{r.reason}</p>
                      </div>
                      {r.expectedBenefit && (
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                            Beklenen Fayda
                          </div>
                          <p className="leading-relaxed whitespace-pre-line">{r.expectedBenefit}</p>
                        </div>
                      )}
                      {r.successCriteria && (
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                            Başarı Kriteri
                          </div>
                          <p className="leading-relaxed whitespace-pre-line">{r.successCriteria}</p>
                        </div>
                      )}
                      {r.dataToUse && (
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                            Kullanılacak Veri
                          </div>
                          <p className="leading-relaxed whitespace-pre-line">{r.dataToUse}</p>
                        </div>
                      )}
                      {r.technicalStack && (
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                            Teknik Yığın
                          </div>
                          <p className="leading-relaxed whitespace-pre-line">{r.technicalStack}</p>
                        </div>
                      )}
                    </div>

                    {r.adminFeedback && (
                      <div
                        className={`mt-4 px-4 py-3 rounded-xl text-sm border-l-4 ${
                          r.status === 'rejected'
                            ? 'bg-red-50 border-red-400 text-red-900'
                            : r.status === 'feedback_requested'
                              ? 'bg-blue-50 border-blue-400 text-blue-900'
                              : 'bg-kt-green-50 border-kt-green-400 text-kt-green-900'
                        }`}
                      >
                        <div className="font-semibold text-xs uppercase tracking-wider mb-1 opacity-70">
                          Admin notu
                        </div>
                        <div className="whitespace-pre-line">{r.adminFeedback}</div>
                        {r.reviewedAt && (
                          <div className="text-xs opacity-60 mt-2">{fmtDate(r.reviewedAt)}</div>
                        )}
                      </div>
                    )}

                    {/* Yönetişim detayı (kapılar + onaylar + zaman çizelgesi) */}
                    {expanded && (
                      <div className="mt-4 pt-4 border-t border-kt-gray-100 space-y-4 animate-fade-in">
                        {bundleLoading && !bundle ? (
                          <div className="text-sm text-kt-gray-400">Yükleniyor…</div>
                        ) : bundle ? (
                          <>
                            <QualityGatesPanel gates={bundle.gates} />
                            {bundle.approvals.length > 0 && (
                              <ApprovalsPanel approvals={bundle.approvals} />
                            )}
                          </>
                        ) : null}
                      </div>
                    )}

                    {/* Aksiyonlar */}
                    <div className="flex justify-end items-center gap-2 mt-4 pt-3 border-t border-kt-gray-100">
                      {isProject && (
                        <button
                          type="button"
                          onClick={() => toggleDetail(r.id)}
                          className="btn-ghost text-sm"
                        >
                          {expanded ? 'Yönetişim detayını gizle' : 'Yönetişim detayı'}
                        </button>
                      )}
                      {(r.status === 'pending' || r.status === 'feedback_requested') && (
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          disabled={submitting || editingId === r.id}
                          className={
                            r.status === 'feedback_requested'
                              ? 'btn-primary text-sm'
                              : 'btn-secondary text-sm'
                          }
                        >
                          {editingId === r.id
                            ? 'Yukarıda düzenleniyor…'
                            : r.status === 'feedback_requested'
                              ? 'Düzelt ve yeniden gönder'
                              : 'Düzenle'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
