/**
 * KVKK ayarları sayfası — kullanıcı veri ihracı + hesap silme.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';

export default function PrivacySettings() {
  const toast = useToast();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [confirmation, setConfirmation] = useState('');
  const [purging, setPurging] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      // direct fetch — file download
      const res = await fetch('/api/user/me/export', {
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('klab:user') ?? '{}').tokens?.accessToken ?? ''}`,
        },
      });
      if (!res.ok) throw new Error('İhracat başarısız.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `klab-verim-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.push('success', 'Veri ihracı indirildi.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'İhracat başarısız.');
    } finally {
      setExporting(false);
    }
  }

  async function handlePurge() {
    if (confirmation !== 'HESABIMI SİL') {
      toast.push('error', "Lütfen 'HESABIMI SİL' yazın.");
      return;
    }
    setPurging(true);
    try {
      // Önce CSRF al
      const csrfRes = await fetch('/api/csrf', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();
      const tokens = JSON.parse(sessionStorage.getItem('klab:user') ?? '{}').tokens;
      const res = await fetch('/api/user/me/purge', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Authorization: `Bearer ${tokens?.accessToken ?? ''}`,
        },
        body: JSON.stringify({ confirmation: 'HESABIMI SİL' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Silme başarısız.');
      }
      const data = await res.json();
      toast.push(
        'info',
        `Hesabınız silindi. ${data.deletedBookings} pending talep silindi, ${data.pseudonymizedBookings} geçmiş kayıt anonimleştirildi.`
      );
      await logout('user');
      navigate('/', { replace: true });
    } catch (err) {
      toast.push('error', (err as Error).message || 'Silme başarısız.');
    } finally {
      setPurging(false);
    }
  }

  return (
    <AppShell kind="user">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Gizlilik & Verilerim</h1>
        <p className="text-kt-gray-500 text-sm">
          KVKK Md.11 — verilerinize erişme, dışa aktarma ve silme hakkınız.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DATA EXPORT */}
        <section className="card p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-kt-green-900">Verilerimi İndir</h2>
              <p className="text-sm text-kt-gray-600 mt-0.5">
                Profil, talepler, bekleme listesi ve kendi audit kayıtlarınız JSON formatında.
              </p>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn-primary w-full text-sm"
          >
            {exporting ? 'Hazırlanıyor...' : 'JSON olarak indir'}
          </button>
          <p className="text-xs text-kt-gray-500 mt-3">
            Dosya hassas verilerinizi içerir — güvenli bir yerde saklayın.
          </p>
        </section>

        {/* RIGHT TO BE FORGOTTEN */}
        <section className="card p-6 border-rose-200">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-rose-900">Hesabımı Sil</h2>
              <p className="text-sm text-rose-700 mt-0.5">
                Geri dönüşü yoktur. Bekleyen talepleriniz silinir, onaylı kayıtlar
                anonimleştirilir.
              </p>
            </div>
          </div>

          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-800 mb-3 space-y-1">
            <div>• Profil bilgileri (isim, e-posta, departman, vs.) silinir</div>
            <div>• <strong>Pending / düzeltme</strong> talepler tamamen silinir</div>
            <div>• <strong>Onaylı / reddedilmiş</strong> talepler tarih bütünlüğü için kalır, açıklamalar anonimleştirilir</div>
            <div>• Tüm oturumlarınız sonlandırılır</div>
            <div>• Audit log (compliance) saklanır</div>
          </div>

          <label className="block text-xs font-semibold text-rose-800 mb-1">
            Onaylamak için aşağıya <code className="px-1 py-0.5 bg-rose-100 rounded">HESABIMI SİL</code> yazın:
          </label>
          <input
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="HESABIMI SİL"
            className="input mb-3"
          />
          <button
            onClick={handlePurge}
            disabled={purging || confirmation !== 'HESABIMI SİL'}
            className="w-full px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {purging ? 'Siliniyor...' : 'Hesabımı kalıcı olarak sil'}
          </button>
        </section>
      </div>

      {/* KVKK INFO */}
      <section className="card p-6 mt-6 bg-kt-green-50 border-kt-green-100">
        <h3 className="text-sm font-bold text-kt-green-900 mb-2">Hangi haklara sahipsiniz?</h3>
        <ul className="text-xs text-kt-green-800 space-y-1.5 leading-relaxed">
          <li>• <strong>Md.11/b — Erişim:</strong> Hangi verilerinizin işlendiğini öğrenme</li>
          <li>• <strong>Md.11/d — Düzeltme:</strong> Yanlış bilgilerin düzeltilmesi (profil sayfasından)</li>
          <li>• <strong>Md.11/e — Silme:</strong> Hesabınızın ve kişisel verilerinizin silinmesi</li>
          <li>• <strong>Md.11/g — İtiraz:</strong> KVKK Kurulu'na şikayet hakkı</li>
        </ul>
        <p className="text-[11px] text-kt-green-700 mt-3 italic">
          Bu demo bir uygulamadır — production'da Veri Sorumlusu iletişim bilgileri burada yer almalıdır.
        </p>
      </section>
    </AppShell>
  );
}
