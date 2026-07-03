/**
 * Aktif oturumun kind'ını döndürür — admin / danisman / arge / user.
 *
 * Tek-oturum politikası gereği aynı anda yalnızca bir oturum açıktır. Admin
 * panel sayfaları (oda, takvim, proje, kullanıcı, lisans) artık danışman ve
 * Ar-Ge tarafından read-only görüntülenebildiğinden, bu sayfalar AppShell'e
 * sabit 'admin' yerine gerçek görüntüleyen kind'ını verir.
 */
import { useAuth } from '../contexts/AuthContext';
import type { SubjectKind } from '../types';

export function useViewerKind(): SubjectKind {
  const auth = useAuth();
  if (auth.admin) return 'admin';
  if (auth.danisman) return 'danisman';
  if (auth.arge) return 'arge';
  if (auth.izleyici) return 'izleyici';
  return 'user';
}
