/**
 * Sohbet & bildirim API'si — rol-bağımsız chat metotları ve bildirim
 * merkezi uçları.
 */
import type { AppNotification, ChatContact, ChatMessage, SubjectKind } from '../../types';
import { notificationBase, request } from './core';

export const chatApi = {
  /* ============ GENEL SOHBET (rol-bağımsız chat) ============ */

  async chatContacts(kind: SubjectKind) {
    return request<{ contacts: ChatContact[] }>('/chat/contacts', { kind });
  },

  async chatConversation(kind: SubjectKind, peerId: string) {
    return request<{ messages: ChatMessage[]; markedRead: number }>(
      `/chat/conversations/${encodeURIComponent(peerId)}`,
      { kind }
    );
  },

  async chatSend(
    kind: SubjectKind,
    recipientId: string,
    recipientKind: 'user' | 'admin',
    body: string
  ) {
    return request<{ message: ChatMessage }>('/chat/messages', {
      method: 'POST',
      body: { recipientId, recipientKind, body },
      kind,
    });
  },

  async chatMarkRead(kind: SubjectKind, peerId: string) {
    return request<{ markedRead: number }>(
      `/chat/conversations/${encodeURIComponent(peerId)}/read`,
      { method: 'POST', kind }
    );
  },

  async chatUnread(kind: SubjectKind) {
    return request<{ unread: number }>('/chat/unread', { kind });
  },

  /* ============ BİLDİRİM MERKEZİ ============ */

  async listNotifications(kind: SubjectKind) {
    return request<{ items: AppNotification[]; unread: number }>(
      `${notificationBase(kind)}/notifications`,
      { kind }
    );
  },

  async markNotificationRead(kind: SubjectKind, id: string) {
    return request<void>(
      `${notificationBase(kind)}/notifications/${encodeURIComponent(id)}/read`,
      { method: 'POST', kind }
    );
  },

  async markAllNotificationsRead(kind: SubjectKind) {
    return request<{ marked: number }>(
      `${notificationBase(kind)}/notifications/read-all`,
      { method: 'POST', kind }
    );
  },
};
