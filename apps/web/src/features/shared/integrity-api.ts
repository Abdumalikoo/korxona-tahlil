import { api, type ApiResponse } from '@/lib/api';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface IntegrityIssue {
  code: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  count: number;
  fixable: boolean;
  details?: string[];
}

export interface IntegrityResult {
  issues: IntegrityIssue[];
  checkedAt: string;
  healthy: boolean;
}

export const integrityApi = {
  check: () => api.get<ApiResponse<IntegrityResult>>('/integrity/check'),

  fix: (code: string) =>
    api.post<ApiResponse<{ fixed: number; message: string }>>(
      `/integrity/fix/${code}`,
    ),
};
