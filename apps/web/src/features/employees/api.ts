import { api, type ApiResponse, type PaginatedResponse } from '@/lib/api';
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
