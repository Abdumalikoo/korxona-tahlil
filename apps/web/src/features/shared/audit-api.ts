import { api, type ApiResponse, type PaginatedResponse } from '@/lib/api';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'RESTORE'
  | 'LOGIN'
  | 'IMPORT'
  | 'EXPORT';

export interface AuditChange {
  from: unknown;
  to: unknown;
}

export interface AuditLog {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  changes: {
    fields?: Record<string, AuditChange>;
    summary?: string | null;
  } | null;
  createdAt: string;
  user: {
    id: string;
    fullName: string;
    username: string;
  };
}

export interface AuditFilters {
  entity?: string;
  action?: AuditAction;
  userId?: string;
  page?: number;
  limit?: number;
}

export const auditApi = {
  list: (filters: AuditFilters) =>
    api.get<PaginatedResponse<AuditLog>>('/audit', {
      params: {
        entity: filters.entity,
        action: filters.action,
        userId: filters.userId,
        page: filters.page,
        limit: filters.limit,
      },
    }),

  /** Bitta yozuvning tarixi */
  byEntity: (entity: string, entityId: string) =>
    api.get<ApiResponse<AuditLog[]>>(`/audit/${entity}/${entityId}`),
};
