/**
 * OpenAPI 3.1 schema — manuel (zod-to-openapi paketi eklemeden, hafif tutuyoruz).
 *
 * /api/openapi.json üzerinden expose edilir; frontend client generation veya
 * 3. parti entegratorlar için kullanılır.
 *
 * Güvenlik:
 * - Bu doküman public — sadece endpoint listesi + tipler.
 * - Credential, secret, key ifşa ETMEZ.
 */

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Kuveyt Türk AI Lab — Randevu Sistemi API',
    version: '1.1.0',
    description:
      'AI Lab oda randevu sistemi API. RS256 JWT auth, ayrı user/admin keypair, ' +
      'cookie tabanlı refresh token rotation, refresh token reuse detection.',
  },
  servers: [
    { url: '/api', description: 'Same-origin (Vite proxy / production reverse-proxy)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      csrfHeader: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        required: ['error'],
      },
      LoginRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
        required: ['email', 'password'],
      },
      LoginResponse: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string', description: 'Geriye uyum — cookie-mode tercih edilir.' },
          expiresIn: { type: 'integer' },
          type: { type: 'string', enum: ['user', 'admin'] },
          subject: { $ref: '#/components/schemas/AuthSubject' },
          mfaRequired: { type: 'boolean' },
        },
        required: ['accessToken', 'expiresIn', 'type', 'subject'],
      },
      AuthSubject: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          fullName: { type: 'string' },
          role: { type: 'string' },
        },
      },
      Room: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          code: { type: 'string' },
          name: { type: 'string' },
          district: { type: 'string' },
          neighborhood: { type: 'string' },
          capacity: { type: 'integer' },
          theme: { type: 'string' },
          isAvailable: { type: 'boolean' },
          nextAvailableDate: { type: 'string', nullable: true },
        },
      },
      Booking: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          roomId: { type: 'string' },
          roomCode: { type: 'string' },
          roomName: { type: 'string' },
          period: { type: 'string', enum: ['1w', '2w', '1m'], description: '1 hafta / 2 hafta / 1 ay' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          projectName: { type: 'string' },
          projectDescription: { type: 'string' },
          helpNeeded: { type: 'string' },
          technologies: { type: 'array', items: { type: 'string' } },
          status: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected', 'feedback_requested', 'cancelled'],
          },
          adminFeedback: { type: 'string', nullable: true },
          createdAt: { type: 'string' },
        },
      },
      WaitlistEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          roomId: { type: 'string' },
          roomCode: { type: 'string' },
          roomName: { type: 'string' },
          period: { type: 'string', enum: ['1w', '2w', '1m'], nullable: true },
          periodMonths: { type: 'integer', nullable: true, description: 'Miras ay-bazlı süre' },
          desiredStartDate: { type: 'string' },
          projectName: { type: 'string' },
          position: { type: 'integer' },
          status: {
            type: 'string',
            enum: ['waiting', 'promoted', 'expired', 'cancelled'],
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Liveness probe',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/csrf': {
      get: {
        summary: 'CSRF token al',
        responses: {
          '200': {
            description: 'Token + cookie',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { csrfToken: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/auth/login': {
      post: {
        summary: 'Unified login (user veya admin)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login başarılı',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginResponse' },
              },
            },
          },
          '401': { description: 'AUTH_FAILED' },
          '423': { description: 'ACCOUNT_LOCKED' },
        },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Yeni user kaydı',
        responses: { '201': { description: 'Created' } },
      },
    },
    '/auth/refresh': {
      post: {
        summary: 'Refresh token rotation (cookie tercih edilir)',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Yeni tokenlar' } },
      },
    },
    '/auth/logout': {
      post: { summary: 'Logout', responses: { '200': { description: 'OK' } } },
    },
    '/events': {
      get: {
        summary: 'Server-Sent Events stream (real-time)',
        description:
          'EventSource ile bağlanılır. `?access_token=...` query veya `Authorization: Bearer` header.',
        responses: {
          '200': { description: 'text/event-stream' },
          '401': { description: 'Auth eksik' },
        },
      },
    },
    '/user/rooms': {
      get: { security: [{ bearerAuth: [] }], summary: 'Oda listesi' },
    },
    '/user/bookings': {
      get: { security: [{ bearerAuth: [] }], summary: 'Kullanıcının booking listesi' },
      post: { security: [{ bearerAuth: [] }], summary: 'Yeni booking oluştur' },
    },
    '/user/bookings/{id}': {
      get: { security: [{ bearerAuth: [] }] },
      put: { security: [{ bearerAuth: [] }] },
      delete: { security: [{ bearerAuth: [] }] },
    },
    '/user/waitlist': {
      get: { security: [{ bearerAuth: [] }] },
      post: { security: [{ bearerAuth: [] }] },
    },
    '/user/waitlist/{id}': {
      delete: { security: [{ bearerAuth: [] }] },
    },
    '/admin/bookings': { get: { security: [{ bearerAuth: [] }] } },
    '/admin/bookings/{id}/review': { post: { security: [{ bearerAuth: [] }] } },
    '/admin/users': { get: { security: [{ bearerAuth: [] }] } },
    '/admin/analytics': { get: { security: [{ bearerAuth: [] }] } },
    '/admin/waitlist': { get: { security: [{ bearerAuth: [] }] } },
    '/admin/mfa/enroll': { post: { security: [{ bearerAuth: [] }] } },
    '/admin/mfa/verify': { post: { security: [{ bearerAuth: [] }] } },
    '/admin/mfa/status': { get: { security: [{ bearerAuth: [] }] } },
    '/public/showcase': { get: { summary: 'Public showcase (auth gerekmez)' } },
    '/public/showcase/technologies': { get: { summary: 'Top teknolojiler' } },
  },
};
