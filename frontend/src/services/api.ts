/**
 * API client — barrel. `api` nesnesi alan modüllerinin (services/api/*)
 * birleşimidir; clearCsrfCache / subscribeEvents / tipler buradan re-export
 * edilir. Altyapı detayları için bkz. services/api/core.ts.
 *
 * NOT: Bölme sırasında dış yüzey birebir korunmadı — hiçbir çağıranı olmayan
 * 12 ölü metot (loginUser/loginAdmin, adminGetUser, *FindSimilar,
 * userCollaborations, myLicenseUsage, showcase/showcaseTechnologies/
 * showcaseEngagement, toggle*Showcase) bilinçli olarak SİLİNDİ;
 * adminSetGovernanceRole ve acceptConsent eklendi.
 */
import { authApi } from './api/auth';
import { bookingsApi } from './api/bookings';
import { roomsApi } from './api/rooms';
import { waitlistApi } from './api/waitlist';
import { licensesApi } from './api/licenses';
import { governanceApi } from './api/governance';
import { hardwareSupportApi } from './api/hardware-support';
import { libraryApi } from './api/library';
import { showcaseApi } from './api/showcase';
import { visualsApi } from './api/visuals';
import { chatApi } from './api/chat';
import { adminUsersApi } from './api/admin-users';
import { adminAnalyticsApi } from './api/admin-analytics';
import { profileApi } from './api/profile';

export { clearCsrfCache, subscribeEvents } from './api/core';
export type { SseSubscription } from './api/core';
export type { LicenseRequestPayload } from './api/licenses';
export type { ExitSurveyAnswers, ProjectSurveyAnswers } from './api/auth';

/* ============================================================
 * API client object — alan modüllerinin düz birleşimi.
 * Metot adları modüller arasında çakışmaz (spread güvenli).
 * ============================================================ */

export const api = {
  ...authApi,
  ...bookingsApi,
  ...roomsApi,
  ...waitlistApi,
  ...licensesApi,
  ...governanceApi,
  ...hardwareSupportApi,
  ...libraryApi,
  ...showcaseApi,
  ...visualsApi,
  ...chatApi,
  ...adminUsersApi,
  ...adminAnalyticsApi,
  ...profileApi,
};
