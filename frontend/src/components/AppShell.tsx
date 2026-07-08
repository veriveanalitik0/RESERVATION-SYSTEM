import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Logo } from './Logo';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import { NotificationCenter } from './NotificationCenter';
import { useNotificationsData } from '../hooks/useNotificationsData';
import { CommandPalette } from './CommandPalette';
import { OnboardingTour } from './OnboardingTour';
import { SupportRequestButton } from './SupportRequestButton';
import { ChatWidget } from './ChatWidget';
import type { SubjectKind } from '../types';

interface AppShellProps {
  kind: SubjectKind;
  children: ReactNode;
  /** Ek nav öğeleri (örn. sayfa-spesifik linkler). Sabit nav listesinin yanına eklenir. */
  nav?: ReactNode;
  /**
   * Varsayılan user/admin nav listesini override eder. Yönetişim rolleri için
   * (analitik_danisman, yz_arge) bu prop ile özel nav geçirilir.
   */
  navItems?: NavItem[];
  /** Override profil "to" — örn. yönetişim dashboard'una geri dönüş için. */
  profileLink?: string;
  /** Profil chip altında gösterilecek rol etiketi (admin yerine "Danışman" gibi). */
  roleLabel?: string;
}

export interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
}

const USER_NAV: NavItem[] = [
  {
    to: '/dashboard',
    label: 'Panom',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>
      </svg>
    ),
  },
  {
    to: '/rooms',
    label: 'Odalar',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
      </svg>
    ),
  },
  {
    to: '/bookings',
    label: 'Taleplerim',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
      </svg>
    ),
  },
  {
    to: '/takvim',
    label: 'Takvim',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
      </svg>
    ),
  },
  {
    to: '/waitlist',
    label: 'Sıramda',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
  },
  {
    to: '/showcase',
    label: 'Envanter',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
      </svg>
    ),
  },
  {
    to: '/kutuphane',
    label: 'Kütüphane',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
      </svg>
    ),
  },
  {
    to: '/liderlik',
    label: 'Leader Board',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 4h2a2 2 0 012 2v1a4 4 0 01-4 4M8 4H6a2 2 0 00-2 2v1a4 4 0 004 4m0 0a4 4 0 008 0M8 11v0m4 5v5m-3 0h6"/>
      </svg>
    ),
  },
  {
    to: '/licenses',
    label: 'Lisanslarım',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
      </svg>
    ),
  },
  {
    to: '/yardim',
    label: 'Yardım',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
  },
  {
    to: '/profile',
    label: 'Profilim',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
      </svg>
    ),
  },
];

const ADMIN_NAV: NavItem[] = [
  {
    to: '/admin',
    label: 'Talepler',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/calendar',
    label: 'Takvim',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/rooms',
    label: 'Odalar',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
      </svg>
    ),
  },
  {
    to: '/admin/analytics',
    label: 'Analiz',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/waitlist',
    label: 'Bekleme',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
  },
  {
    to: '/admin/users',
    label: 'Kullanıcılar',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
      </svg>
    ),
  },
  {
    to: '/admin/projects',
    label: 'Projeler',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/licenses',
    label: 'Lisanslar',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
      </svg>
    ),
  },
  {
    to: '/admin/hardware',
    label: 'Donanım',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/support',
    label: 'Destek',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
  },
  {
    to: '/showcase',
    label: 'Envanter',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/kutuphane',
    label: 'Kütüphane',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
      </svg>
    ),
  },
  {
    to: '/admin/audit',
    label: 'Audit',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>
    ),
  },
  {
    to: '/admin/security',
    label: 'Güvenlik',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
      </svg>
    ),
  },
];

/**
 * Danışman + Ar-Ge'nin read-only görüntüleyebildiği admin panel sayfaları.
 * Governance dashboard'ları kendi NAV_ITEMS'ına bu listeyi ekler.
 */
// eslint-disable-next-line react-refresh/only-export-components -- sabit nav dizisi; HMR icin sorun degil
export const STAFF_VIEW_NAV: NavItem[] = [
  {
    to: '/admin/rooms',
    label: 'Odalar',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
      </svg>
    ),
  },
  {
    to: '/admin/calendar',
    label: 'Takvim',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/projects',
    label: 'Projeler',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/users',
    label: 'Kullanıcılar',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
      </svg>
    ),
  },
  {
    to: '/admin/licenses',
    label: 'Lisanslar',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
      </svg>
    ),
  },
  {
    to: '/showcase',
    label: 'Envanter',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
      </svg>
    ),
  },
  {
    to: '/admin/kutuphane',
    label: 'Kütüphane',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
      </svg>
    ),
  },
];

/** Analitik Danışman nav — kendi inbox'ı + read-only admin görünümleri. */
// eslint-disable-next-line react-refresh/only-export-components -- sabit nav dizisi; HMR icin sorun degil
export const DANISMAN_NAV: NavItem[] = [
  {
    to: '/danisman',
    label: 'Gelen Talepler',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
    ),
  },
  ...STAFF_VIEW_NAV,
];

/** YZ / Ar-Ge nav — proje yaşam döngüsü + read-only admin görünümleri. */
// eslint-disable-next-line react-refresh/only-export-components -- sabit nav dizisi; HMR icin sorun degil
export const ARGE_NAV: NavItem[] = [
  {
    to: '/arge',
    label: 'Yaşam Döngüsü',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/>
      </svg>
    ),
  },
  ...STAFF_VIEW_NAV,
];

/** İzleyici nav — genel bakış + read-only admin görünümleri. */
// eslint-disable-next-line react-refresh/only-export-components -- sabit nav dizisi; HMR icin sorun degil
export const IZLEYICI_NAV: NavItem[] = [
  {
    to: '/izleyici',
    label: 'Genel Bakış',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
  },
  ...STAFF_VIEW_NAV,
];

/** Bir kind için varsayılan nav listesini döndürür. */
function navForKind(kind: SubjectKind): NavItem[] {
  if (kind === 'admin') return ADMIN_NAV;
  if (kind === 'danisman') return DANISMAN_NAV;
  if (kind === 'arge') return ARGE_NAV;
  if (kind === 'izleyici') return IZLEYICI_NAV;
  return USER_NAV;
}

// Kullanıcının profil fotoğrafı — auth subject'i taşımadığından profilden çekilir.
// Modül seviyesi cache: her sayfa gezinmesinde AppShell remount olsa da tekrar
// tekrar fetch atılmasın. ÖZNE (user) id'sine göre ANAHTARLI — aksi halde tek-oturum
// SPA'da logout/login sonrası önceki kullanıcının foto'su başka kullanıcıya/role
// sızıyordu (test user pp'si danışman/arge avatarında görünme bug'ı).
let cachedUserPhoto: { id: string; photo: string | null } | null = null;

export function AppShell({
  kind,
  children,
  nav,
  navItems,
  profileLink,
  roleLabel,
}: AppShellProps) {
  const auth = useAuth();
  const { logout } = auth;
  const toast = useToast();
  const navigate = useNavigate();
  const me =
    kind === 'admin'
      ? auth.admin
      : kind === 'danisman'
        ? auth.danisman
        : kind === 'arge'
          ? auth.arge
          : kind === 'izleyici'
            ? auth.izleyici
            : auth.user;

  // Profil fotoğrafını header avatarında göster — YALNIZ 'user' kind. Danışman/arge/
  // izleyici governance token'ıyla /user/profile'a erişemez (admin sabit görsel
  // kullanır) → onlar baş harf gösterir. Cache yalnız aynı user id için kullanılır.
  const [userPhoto, setUserPhoto] = useState<string | null>(
    kind === 'user' && cachedUserPhoto && cachedUserPhoto.id === auth.user?.id
      ? cachedUserPhoto.photo
      : null
  );
  useEffect(() => {
    if (kind !== 'user' || !auth.user?.id) return;
    const uid = auth.user.id;
    let active = true;
    api
      .getProfile()
      .then((r) => {
        if (!active) return;
        cachedUserPhoto = { id: uid, photo: r.profile.profilePhoto };
        setUserPhoto(r.profile.profilePhoto);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [kind, auth.user?.id]);

  // Bildirim verisi — zil + menü rozetleri için tek kaynak.
  const location = useLocation();
  const notif = useNotificationsData(kind);
  const { markItemRead } = notif;

  // Mobil (md altı) açılır navigasyon menüsü durumu.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Rota değişince mobil menüyü kapat (kullanıcı bir öğeye tıklayınca).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Açık olan bölümün okunmamış bildirimleri okundu işaretlenir → menü rozeti
  // temizlenir. notif.items bağımlılıkta: bildirimler navigasyondan SONRA
  // yüklenirse (yarış durumu) etki yeniden çalışıp rozeti yine temizler.
  useEffect(() => {
    for (const n of notif.items) {
      if (!n.read && n.link === location.pathname) {
        void markItemRead(n);
      }
    }
  }, [location.pathname, notif.items, markItemRead]);

  /** Bir nav öğesi için okunmamış bildirim sayısı (menü rozeti). */
  function badgeCount(to: string): number {
    if (to === '/sohbet') return notif.messageUnread;
    return notif.items.filter((n) => !n.read && n.link === to).length;
  }

  // Sohbet tüm rollerde görünür — rolün kendi nav'ının sonuna eklenir.
  const items: NavItem[] = [
    ...(navItems ?? navForKind(kind)),
    {
      to: '/sohbet',
      label: 'Sohbet',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
  ];
  const effectiveProfileLink =
    profileLink ??
    (kind === 'admin'
      ? '/admin'
      : kind === 'danisman'
        ? '/danisman'
        : kind === 'arge'
          ? '/arge'
          : kind === 'izleyici'
            ? '/izleyici'
            : '/profile');
  const effectiveRoleLabel =
    roleLabel ??
    (kind === 'admin'
      ? 'Yönetici'
      : kind === 'danisman'
        ? 'Analitik Danışman'
        : kind === 'arge'
          ? 'YZ / Ar-Ge'
          : kind === 'izleyici'
            ? 'İzleyici'
            : 'Kullanıcı');

  async function handleLogout() {
    try {
      await logout(kind);
      toast.push('info', 'Çıkış yapıldı.');
      navigate('/login', { replace: true });
    } catch {
      toast.push('error', 'Çıkış sırasında bir sorun oluştu.');
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-ai-light relative">
      {/* Erişilebilirlik: klavye kullanıcısı için "İçeriğe atla" — yalnız odaklanınca görünür. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-kt-gold-400 focus:text-kt-green-950 focus:font-semibold focus:shadow-kt-card"
      >
        İçeriğe atla
      </a>
      <header className="bg-gradient-to-r from-kt-green-950 via-kt-green-900 to-kt-green-950 border-b border-kt-gold-400/20 sticky top-0 z-40 shadow-glow-blue">
        {/* AI neural overlay */}
        <div className="absolute inset-0 bg-neural-grid-dark opacity-30 pointer-events-none" />
        <div className="absolute -top-10 left-1/4 w-72 h-32 bg-kt-gold-400/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <Link to={items[0].to} className="shrink-0">
            <Logo size="sm" />
          </Link>

          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            {nav}
            {/* Mobil (md altı) hamburger — açılır navigasyon menüsünü kontrol eder. */}
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="md:hidden p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-kt-gold-300 transition-colors"
              aria-label="Menü"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav-menu"
            >
              {mobileNavOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
            <button
              onClick={() => {
                const evt = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
                window.dispatchEvent(evt);
              }}
              className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-kt-gold-300 text-xs transition-all"
              title="Komut paleti (⌘K)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Ara</span>
              <kbd className="text-[10px] bg-white/10 px-1 py-0.5 rounded">⌘K</kbd>
            </button>
            <NotificationCenter
              items={notif.items}
              unread={notif.unread}
              messageUnread={notif.messageUnread}
              onMarkAllRead={notif.markAllRead}
              onItemRead={notif.markItemRead}
            />
            <Link
              to={effectiveProfileLink}
              className="hidden 2xl:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-kt-gold-400/30 transition-all"
              title={effectiveRoleLabel}
            >
              <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-kt-gold-400 to-kt-gold-600 text-kt-green-950 flex items-center justify-center font-bold text-xs shadow-glow-cyan">
                {kind === 'admin' ? (
                  <img src="/admin-pp.png" alt="" className="w-full h-full object-cover" />
                ) : kind === 'user' && userPhoto ? (
                  <img src={userPhoto} alt="" className="w-full h-full object-cover" />
                ) : (
                  me?.fullName?.split(' ').map((p) => p[0]).slice(0, 2).join('') ?? '??'
                )}
              </div>
              <div className="text-xs">
                <div className="font-semibold text-white leading-tight">{me?.fullName}</div>
                <div className="text-kt-gold-300/80 leading-tight">
                  {effectiveRoleLabel}
                </div>
              </div>
            </Link>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white/70 hover:text-white hover:bg-rose-500/20 transition-colors"
            >
              Çıkış
            </button>
          </div>
        </div>

        {/* Ana navigasyon — ikinci satır (masaüstü, md ve üstü). Sığdığında ortalı,
            taşınca yatay kaydırılır. md altında gizlenir; yerine hamburger menü gelir. */}
        <nav
          aria-label="Ana navigasyon"
          className="hidden md:block border-t border-kt-gold-400/15 px-6 py-2 overflow-x-auto scrollbar-thin relative"
        >
          <div className="flex items-center gap-1 mx-auto w-max">
            {items.map((item) => {
              const badge = badgeCount(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/admin' || item.to === '/rooms'}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-kt-gold-400/15 text-kt-gold-300 ring-1 ring-kt-gold-400/40'
                        : 'text-white/60 hover:text-kt-gold-300'
                    }`
                  }
                >
                  {item.icon}
                  {item.label}
                  {badge > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* Mobil açılır navigasyon menüsü (md altı) — hamburger ile kontrol edilir.
            Nav öğeleri + profil çipi + komut paleti burada erişilebilir. */}
        {mobileNavOpen && (
          <nav
            id="mobile-nav-menu"
            aria-label="Mobil navigasyon"
            className="md:hidden border-t border-kt-gold-400/15 px-4 py-3 relative max-h-[70vh] overflow-y-auto scrollbar-thin"
          >
            <div className="flex flex-col gap-1">
              {items.map((item) => {
                const badge = badgeCount(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/admin' || item.to === '/rooms'}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) =>
                      `px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2.5 transition-colors ${
                        isActive
                          ? 'bg-kt-gold-400/15 text-kt-gold-300 ring-1 ring-kt-gold-400/40'
                          : 'text-white/70 hover:text-kt-gold-300 hover:bg-white/5'
                      }`
                    }
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 && (
                      <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                        {badge > 9 ? '9+' : badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}

              {/* Komut paleti — masaüstünde sağ üstte; mobilde menü içinde. */}
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  const evt = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
                  window.dispatchEvent(evt);
                }}
                className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2.5 text-white/70 hover:text-kt-gold-300 hover:bg-white/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span className="flex-1 text-left">Ara (Komut paleti)</span>
                <kbd className="text-[10px] bg-white/10 px-1 py-0.5 rounded">⌘K</kbd>
              </button>

              {/* Profil çipi — masaüstünde 2xl'de görünür; mobilde menü içinde. */}
              <Link
                to={effectiveProfileLink}
                onClick={() => setMobileNavOpen(false)}
                className="mt-1 px-3 py-2 rounded-lg flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-kt-gold-400/30 transition-all"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-kt-gold-400 to-kt-gold-600 text-kt-green-950 flex items-center justify-center font-bold text-xs shadow-glow-cyan shrink-0">
                  {kind === 'admin' ? (
                    <img src="/admin-pp.png" alt="" className="w-full h-full object-cover" />
                  ) : kind === 'user' && userPhoto ? (
                    <img src={userPhoto} alt="" className="w-full h-full object-cover" />
                  ) : (
                    me?.fullName?.split(' ').map((p) => p[0]).slice(0, 2).join('') ?? '??'
                  )}
                </div>
                <div className="text-xs min-w-0">
                  <div className="font-semibold text-white leading-tight truncate">{me?.fullName}</div>
                  <div className="text-kt-gold-300/80 leading-tight">{effectiveRoleLabel}</div>
                </div>
              </Link>
            </div>
          </nav>
        )}
      </header>

      <main id="main-content" tabIndex={-1} className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-6 py-8 animate-fade-in focus:outline-none">
        {children}
      </main>

      <footer className="relative z-10 border-t border-kt-gray-200 bg-gradient-to-r from-kt-green-950 to-kt-green-900 py-4 text-center text-xs text-white/50">
        <span className="text-kt-gold-400 font-semibold">Kuveyt Türk</span>
        <span className="mx-2 text-kt-gold-400/40">·</span>
        Yapay Zeka Laboratuvarı
        <span className="mx-2 text-kt-gold-400/40">·</span>
        Demo Ortam
      </footer>

      {/* Global overlays */}
      <CommandPalette kind={kind} />
      <OnboardingTour kind={kind} />
      {/* Destek talebi: admin'e ve salt-okunur izleyiciye gösterilmez (izleyici
          değişiklik yapamaz; aksi halde alttaki destek FAB'ı sohbet sanılıp
          tıklanınca izleyici token'ıyla hata veriyordu). */}
      {kind !== 'admin' && kind !== 'izleyici' && <SupportRequestButton kind={kind} />}
      <ChatWidget />
    </div>
  );
}
