import { api, getToken, type ApiResponse, type PaginatedResponse } from '@/lib/api';
import type {
  Employee,
  EmployeeStats,
  EmploymentType,
  Region,
  RegionWithDistricts,
  District,
} from '@/lib/types';

export interface EmployeeFilters {
  search?: string;
  regionCode?: number;
  districtId?: string;
  departmentId?: string;
  employmentType?: EmploymentType;
  /** markaz-shtat | tuman-shtat | shartnoma */
  group?: string;
  includeInactive?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateEmployeePayload {
  pinfl: string;
  lastName: string;
  firstName: string;
  middleName?: string;
  employmentType: EmploymentType;
  regionCode: number;
  districtId?: string | null;
  departmentId?: string | null;
  position?: string;
  hiredAt?: string;
  isActive?: boolean;
}

export type UpdateEmployeePayload = Partial<Omit<CreateEmployeePayload, 'pinfl'>> & {
  firedAt?: string | null;
};

export interface RegionCount {
  regionCode: number;
  name: string;
  count: number;
}

export interface DepartmentCount {
  departmentId: string | null;
  name: string;
  count: number;
}

/** Xodimlar royxatini Excel faylga yuklab oladi */
export async function downloadEmployeesExcel(
  filters: EmployeeFilters,
): Promise<void> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  search.delete('page');
  search.delete('limit');

  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
  const token = getToken();

  const response = await fetch(`${base}/employees/export?${search.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error('Faylni yuklab bolmadi');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : 'Xodimlar.xlsx';

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export const employeesApi = {
  list: (filters: EmployeeFilters) =>
    api.get<PaginatedResponse<Employee>>('/employees', { params: filters }),

  getOne: (pinfl: string) => api.get<ApiResponse<Employee>>(`/employees/${pinfl}`),

  create: (payload: CreateEmployeePayload) =>
    api.post<ApiResponse<Employee>>('/employees', payload),

  update: (pinfl: string, payload: UpdateEmployeePayload) =>
    api.patch<ApiResponse<Employee>>(`/employees/${pinfl}`, payload),

  archive: (pinfl: string) =>
    api.patch<ApiResponse<Employee>>(`/employees/${pinfl}/archive`),

  remove: (pinfl: string) =>
    api.delete<ApiResponse<{ success: true }>>(`/employees/${pinfl}`),

  usage: (pinfl: string) =>
    api.get<ApiResponse<{ payrollEntries: number }>>(`/employees/${pinfl}/usage`),

  stats: () => api.get<ApiResponse<EmployeeStats>>('/employees/stats'),

  byRegion: () => api.get<ApiResponse<RegionCount[]>>('/employees/by-region'),

  byDepartment: () => api.get<ApiResponse<DepartmentCount[]>>('/employees/by-department'),
};

export const regionsApi = {
  list: () => api.get<ApiResponse<Region[]>>('/regions'),

  /** Viloyatlar tumanlari bilan - tanlagich uchun */
  tree: () => api.get<ApiResponse<RegionWithDistricts[]>>('/regions/tree'),

  districts: (regionCode: number) =>
    api.get<ApiResponse<District[]>>(`/regions/${regionCode}/districts`),
};
