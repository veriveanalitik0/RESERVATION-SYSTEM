/**
 * Admin Odalar sayfası — hangi odada kim var.
 *
 * Her oda kartı odadaki aktif booking'leri (kullanıcı, proje, tarih, durum)
 * listeler. Admin bir booking'i:
 *   - Başka odaya taşıyabilir (oda ataması değiştirme)
 *   - Başka kullanıcıya devredebilir (kullanıcı yeniden atama)
 *   - Tamamen silebilir (kullanıcıyı odadan çıkar)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppShell } from '../components/AppShell';
import { useViewerKind } from '../hooks/useViewerKind';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { RoomOccupant, RoomWithOccupancy, UserListItem } from '../types';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function occupantBadge(status: RoomOccupant['status']) {
  switch (status) {
    case 'approved':
      return { label: 'Onaylı', cls: 'bg-kt-green-100 text-kt-green-800 border-kt-green-300' };
    case 'pending':
      return { label: 'Beklemede', cls: 'bg-kt-gold-100 text-kt-gold-800 border-kt-gold-300' };
    case 'feedback_requested':
      return { label: 'Revize', cls: 'bg-blue-100 text-blue-800 border-blue-300' };
  }
}

interface ReassignTarget {
  occupant: RoomOccupant;
  fromRoom: RoomWithOccupancy;
}

interface ReassignUserTarget {
  occupant: RoomOccupant;
  fromRoom: RoomWithOccupancy;
}

interface DeleteTarget {
  occupant: RoomOccupant;
  fromRoom: RoomWithOccupancy;
}

export default function AdminRooms() {
  const toast = useToast();
  const viewerKind = useViewerKind();
  const canEdit = viewerKind === 'admin';
  const [rooms, setRooms] = useState<RoomWithOccupancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Oda değiştirme modalı
  const [reassign, setReassign] = useState<ReassignTarget | null>(null);
  const [targetRoomId, setTargetRoomId] = useState('');

  // Kullanıcı değiştirme modalı
  const [reassignUser, setReassignUser] = useState<ReassignUserTarget | null>(null);
  const [targetUserId, setTargetUserId] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userList, setUserList] = useState<UserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Silme onayı modalı
  const [del, setDel] = useState<DeleteTarget | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminRoomsOccupancy();
      setRooms(res.rooms);
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeEvents('admin', (type) => {
    if (type.startsWith('booking.')) void load();
  });

  // Kullanıcı değiştirme modalı açıldığında aktif kullanıcı listesini çek.
  useEffect(() => {
    if (!reassignUser) return;
    let alive = true;
    setUsersLoading(true);
    api
      .adminListUsers({ status: 'active' })
      .then((res) => {
        if (alive) setUserList(res.users);
      })
      .catch((err) => {
        if (alive) toast.push('error', (err as Error).message);
      })
      .finally(() => {
        if (alive) setUsersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reassignUser, toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.district.toLowerCase().includes(q) ||
        r.neighborhood.toLowerCase().includes(q) ||
        r.bookings.some(
          (b) =>
            b.userFullName.toLowerCase().includes(q) ||
            b.projectName.toLowerCase().includes(q)
        )
    );
  }, [rooms, search]);

  const totals = useMemo(
    () => ({
      rooms: rooms.length,
      occupied: rooms.filter((r) => r.approvedCount > 0).length,
      free: rooms.filter((r) => r.bookings.length === 0).length,
      people: rooms.reduce((s, r) => s + r.approvedCount, 0),
    }),
    [rooms]
  );

  // Kullanıcı seçim modalındaki arama
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const excludeId = reassignUser?.occupant.userId;
    return userList.filter((u) => {
      if (excludeId && u.id === excludeId) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.department ?? '').toLowerCase().includes(q)
      );
    });
  }, [userList, userSearch, reassignUser]);

  function openReassign(occupant: RoomOccupant, fromRoom: RoomWithOccupancy) {
    setReassign({ occupant, fromRoom });
    setTargetRoomId('');
  }

  function openReassignUser(occupant: RoomOccupant, fromRoom: RoomWithOccupancy) {
    setReassignUser({ occupant, fromRoom });
    setTargetUserId('');
    setUserSearch('');
  }

  function openDelete(occupant: RoomOccupant, fromRoom: RoomWithOccupancy) {
    setDel({ occupant, fromRoom });
  }

  async function submitReassign() {
    if (!reassign || !targetRoomId || submitting) return;
    setSubmitting(true);
    try {
      await api.adminReassignBooking(reassign.occupant.bookingId, targetRoomId);
      toast.push('success', 'Booking yeni odaya taşındı.');
      setReassign(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReassignUser() {
    if (!reassignUser || !targetUserId || submitting) return;
    setSubmitting(true);
    try {
      await api.adminReassignBookingUser(reassignUser.occupant.bookingId, targetUserId);
      toast.push('success', 'Booking yeni kullanıcıya devredildi.');
      setReassignUser(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDelete() {
    if (!del || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.adminDeleteBooking(del.occupant.bookingId);
      if (res.wasApproved) {
        toast.push('success', 'Booking silindi — bekleme listesinden sıradaki kişi otomatik aday oldu.');
      } else {
        toast.push('success', 'Booking silindi.');
      }
      setDel(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell kind={viewerKind}>
      {!canEdit && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Görüntüleme modu — bu sayfada değişiklik yapamazsınız.
        </div>
      )}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Odalar</h1>
        <p className="text-kt-gray-500 text-sm">
          Hangi odada kim var — aktif booking'leri görüntüle, oda atamalarını değiştir,
          kullanıcı devret veya kaldır.
        </p>
      </div>

      {/* Özet + arama */}
      <div className="card p-4 md:p-5 mb-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <div className="flex gap-2 flex-wrap text-sm">
          <span className="px-3 py-1.5 rounded-lg bg-kt-green-50 text-kt-green-800 font-semibold">
            {totals.rooms} oda
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-kt-gold-50 text-kt-gold-800 font-semibold">
            {totals.occupied} dolu
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-kt-gray-100 text-kt-gray-600 font-semibold">
            {totals.free} boş
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-kt-violet-100 text-kt-violet-700 font-semibold">
            {totals.people} aktif kullanıcı
          </span>
        </div>
        <div className="relative md:max-w-xs flex-1">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-kt-gray-400"
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            className="input pl-10"
            placeholder="Oda, kullanıcı veya proje ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={60}
          />
        </div>
      </div>

      {/* Oda kartları */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-44" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="rooms"
          tone="cyan"
          title="Eşleşen oda yok"
          description="Filtreyi sıfırlayıp tüm odaları görün."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((room) => (
            <article key={room.id} className="card p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-bold text-kt-green-900 break-all">
                      {room.code}
                    </span>
                  </div>
                  <div className="text-xs text-kt-gray-500 mt-0.5">
                    {room.name} · {room.neighborhood} ·{' '}
                    {room.capacity === 1
                      ? '1 kişilik'
                      : `${room.capacity} kişilik`}
                  </div>
                  {room.equipment && (
                    <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 rounded-md bg-kt-violet-100 text-kt-violet-800 text-[11px] font-semibold border border-kt-violet-300">
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                      {room.equipment}
                    </div>
                  )}
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-1 rounded-md border ${
                    room.bookings.length === 0
                      ? 'bg-kt-gray-100 text-kt-gray-500 border-kt-gray-200'
                      : 'bg-kt-green-100 text-kt-green-800 border-kt-green-300'
                  }`}
                >
                  {room.bookings.length === 0
                    ? 'Boş'
                    : `${room.approvedCount} onaylı · ${room.pendingCount} bekleyen`}
                </span>
              </div>

              {room.bookings.length === 0 ? (
                <div className="text-sm text-kt-gray-400 italic py-3">
                  Bu odada aktif booking yok.
                </div>
              ) : (
                <ul className="space-y-2">
                  {room.bookings.map((b) => {
                    const badge = occupantBadge(b.status);
                    return (
                      <li
                        key={b.bookingId}
                        className="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-2 rounded-lg bg-kt-gray-50 border border-kt-gray-200"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-kt-green-600 to-kt-green-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
                            {b.userFullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-kt-green-900 truncate">
                              {b.userFullName}
                            </div>
                            <div className="text-xs text-kt-gray-500 truncate">
                              {b.projectName} · {fmtDate(b.startDate)} – {fmtDate(b.endDate)}
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-1 sm:gap-2 shrink-0 self-end sm:self-auto">
                            <button
                              type="button"
                              onClick={() => openReassign(b, room)}
                              className="text-[11px] font-semibold px-2 py-1 rounded-md text-kt-green-700 hover:bg-kt-green-50 hover:text-kt-green-800 transition"
                              title="Bu booking'i başka odaya taşı"
                            >
                              Oda Değiştir
                            </button>
                            <button
                              type="button"
                              onClick={() => openReassignUser(b, room)}
                              className="text-[11px] font-semibold px-2 py-1 rounded-md text-kt-violet-700 hover:bg-kt-violet-100 transition"
                              title="Bu odadaki kullanıcıyı başka bir kullanıcı ile değiştir"
                            >
                              Kullanıcı Değiştir
                            </button>
                            <button
                              type="button"
                              onClick={() => openDelete(b, room)}
                              className="text-[11px] font-semibold px-2 py-1 rounded-md text-rose-700 hover:bg-rose-50 transition"
                              title="Bu booking'i sil (kullanıcıyı odadan çıkar)"
                            >
                              Sil
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Oda değiştirme modalı */}
      {reassign && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-kt-green-900 mb-1">Oda Değiştir</h3>
            <p className="text-sm text-kt-gray-500 mb-4">
              <span className="font-semibold">{reassign.occupant.userFullName}</span> —{' '}
              {reassign.occupant.projectName}
              <br />
              Mevcut oda: <strong>{reassign.fromRoom.code}</strong>
            </p>

            <label className="label">Yeni oda</label>
            <select
              className="input mb-4"
              value={targetRoomId}
              onChange={(e) => setTargetRoomId(e.target.value)}
              disabled={submitting}
            >
              <option value="">— Oda seç —</option>
              {rooms
                .filter((r) => r.id !== reassign.fromRoom.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} · {r.name} ({r.approvedCount} onaylı)
                  </option>
                ))}
            </select>

            <p className="text-xs text-kt-gray-500 mb-4">
              Onaylı bir booking taşınırken hedef oda aynı tarih aralığında dolu olmamalı.
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReassign(null)}
                disabled={submitting}
                className="btn-ghost"
              >
                İptal
              </button>
              <button
                onClick={submitReassign}
                disabled={submitting || !targetRoomId}
                className="btn-primary"
              >
                {submitting ? 'Taşınıyor…' : 'Taşı'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Kullanıcı değiştirme modalı */}
      {reassignUser && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-slide-up flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-kt-green-900 mb-1">Kullanıcı Değiştir</h3>
            <p className="text-sm text-kt-gray-500 mb-4">
              <span className="font-semibold">{reassignUser.fromRoom.code}</span> odası — şu anki
              kullanıcı: <strong>{reassignUser.occupant.userFullName}</strong>
              <br />
              Booking yeni seçilen kullanıcıya devredilir; tarihler ve proje bilgisi değişmez.
            </p>

            <div className="relative mb-3">
              <svg
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-kt-gray-400"
                fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="search"
                className="input pl-10"
                placeholder="İsim, e-posta veya departmana göre ara..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                disabled={submitting}
                maxLength={60}
              />
            </div>

            <div className="border border-kt-gray-200 rounded-xl overflow-y-auto flex-1 mb-4 max-h-72">
              {usersLoading ? (
                <div className="p-4 text-sm text-kt-gray-500 text-center">Yükleniyor…</div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-4 text-sm text-kt-gray-500 text-center">
                  Eşleşen kullanıcı bulunamadı.
                </div>
              ) : (
                <ul className="divide-y divide-kt-gray-100">
                  {filteredUsers.map((u) => {
                    const selected = u.id === targetUserId;
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => setTargetUserId(u.id)}
                          disabled={submitting}
                          className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition ${
                            selected
                              ? 'bg-kt-violet-50 ring-1 ring-inset ring-kt-violet-300'
                              : 'hover:bg-kt-gray-50'
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-kt-violet-500 to-kt-violet-700 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                            {u.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-kt-green-900 truncate">
                              {u.fullName}
                            </div>
                            <div className="text-xs text-kt-gray-500 truncate">
                              {u.email}
                              {u.department ? ` · ${u.department}` : ''}
                            </div>
                          </div>
                          {selected && (
                            <svg
                              className="w-4 h-4 text-kt-violet-700 shrink-0"
                              fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReassignUser(null)}
                disabled={submitting}
                className="btn-ghost"
              >
                İptal
              </button>
              <button
                onClick={submitReassignUser}
                disabled={submitting || !targetUserId}
                className="btn-primary"
              >
                {submitting ? 'Devrediliyor…' : 'Devret'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Silme onay modalı */}
      {del && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-kt-green-900">Booking'i Sil</h3>
                <p className="text-sm text-kt-gray-500">Bu işlem geri alınamaz.</p>
              </div>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-4 text-sm">
              <div className="font-semibold text-rose-800">
                {del.occupant.userFullName}
              </div>
              <div className="text-rose-700 mt-0.5">
                {del.fromRoom.code} · {del.occupant.projectName}
              </div>
              <div className="text-rose-600 text-xs mt-1">
                {fmtDate(del.occupant.startDate)} – {fmtDate(del.occupant.endDate)} ·{' '}
                {occupantBadge(del.occupant.status).label}
              </div>
            </div>

            <p className="text-xs text-kt-gray-500 mb-4">
              {del.occupant.status === 'approved'
                ? 'Bu booking onaylıydı. Silindiğinde bekleme listesindeki sıradaki kişi otomatik olarak aday hale gelir.'
                : 'Booking veritabanından kalıcı olarak silinir.'}
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDel(null)}
                disabled={submitting}
                className="btn-ghost"
              >
                Vazgeç
              </button>
              <button
                onClick={submitDelete}
                disabled={submitting}
                className="btn-danger"
              >
                {submitting ? 'Siliniyor…' : 'Evet, Sil'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </AppShell>
  );
}
