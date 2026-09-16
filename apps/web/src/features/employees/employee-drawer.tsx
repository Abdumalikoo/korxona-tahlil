'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { employeesApi } from './api';
import { formatDate } from '@/lib/format';

import { Drawer } from '@/components/ui/drawer';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { LocationPicker } from '@/components/shared/location-picker';
import type {
  Employee,
  RegionWithDistricts,
  Department,
  EmploymentType,
} from '@/lib/types';

const CENTRAL_REGION = 0;

const employmentTypes: { value: EmploymentType; label: string }[] = [
  { value: 'SHTAT', label: 'Asosiy shtat' },
  { value: 'SHARTNOMA', label: 'Shartnoma' },
];

interface EmployeeDrawerProps {
  employee: Employee | null;
  creating: boolean;
  regions: RegionWithDistricts[];
  departments: Department[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  pinfl: string;
  lastName: string;
  firstName: string;
  middleName: string;
  employmentType: EmploymentType;
  regionCode: number | null;
  districtId: string | null;
  departmentId: string;
  position: string;
  hiredAt: string;
}

function emptyForm(): FormState {
  return {
    pinfl: '',
    lastName: '',
    firstName: '',
    middleName: '',
    employmentType: 'SHTAT',
    regionCode: null,
    districtId: null,
    departmentId: '',
    position: '',
    hiredAt: '',
  };
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

export function EmployeeDrawer({
  employee,
  creating,
  regions,
  departments,
  onClose,
  onSaved,
}: EmployeeDrawerProps) {
  const { isAdmin } = useAuth();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isOpen = employee !== null || creating;
  const isEditing = employee !== null;

  useEffect(() => {
    if (employee) {
      setForm({
        pinfl: employee.pinfl,
        lastName: employee.lastName,
        firstName: employee.firstName,
        middleName: employee.middleName ?? '',
        employmentType: employee.employmentType,
        regionCode: employee.regionCode,
        districtId: employee.districtId,
        departmentId: employee.departmentId ?? '',
        position: employee.position ?? '',
        hiredAt: toDateInput(employee.hiredAt),
      });
    } else {
      setForm(emptyForm());
    }
    setErrors({});
    setServerError(null);
  }, [employee, creating]);

  if (!isOpen) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((state) => ({ ...state, [key]: value }));
    setErrors((state) => {
      if (!state[key]) return state;
      const next = { ...state };
      delete next[key];
      return next;
    });
  }

  function validate(): boolean {
    const found: Record<string, string> = {};

    if (!isEditing) {
      if (!/^\d{14}$/.test(form.pinfl)) {
        found.pinfl = 'PINFL 14 ta raqamdan iborat bo\u2018lishi kerak';
      }
    }

    if (!form.lastName.trim()) found.lastName = 'Familiyani kiriting';
    if (!form.firstName.trim()) found.firstName = 'Ismni kiriting';
    if (form.regionCode === null) found.region = 'Hududni tanlang';

    if (form.regionCode === CENTRAL_REGION && !form.departmentId) {
      found.departmentId = 'Markaz xodimi uchun bo\u2018lim majburiy';
    }

    if (
      form.regionCode !== null &&
      form.regionCode !== CENTRAL_REGION &&
      !form.districtId
    ) {
      found.district = 'Tumanni tanlang';
    }

    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;

    setSaving(true);
    setServerError(null);

    const isCentral = form.regionCode === CENTRAL_REGION;

    const payload = {
      lastName: form.lastName.trim(),
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim() || undefined,
      employmentType: form.employmentType,
      regionCode: form.regionCode ?? 0,
      districtId: isCentral ? null : form.districtId,
      departmentId: isCentral ? form.departmentId : null,
      position: form.position.trim() || undefined,
      hiredAt: form.hiredAt || undefined,
    };

    try {
      if (employee) {
        await employeesApi.update(employee.pinfl, payload);
        onSaved('O\u2018zgarishlar saqlandi');
      } else {
        await employeesApi.create({ pinfl: form.pinfl, ...payload });
        onSaved('Xodim qo\u2018shildi');
      }
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Saqlashda xatolik');
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!employee) return;

    setArchiving(true);

    try {
      await employeesApi.archive(employee.pinfl);
      onSaved('Xodim arxivlandi');
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Xatolik');
      setConfirmOpen(false);
    } finally {
      setArchiving(false);
    }
  }

  const departmentOptions = [
    { value: '', label: 'Tanlang' },
    ...departments.map((dept) => ({
      value: dept.id,
      label: `${dept.index} \u2014 ${dept.name}`,
    })),
  ];

  const readOnly = !isAdmin;
  const isCentral = form.regionCode === CENTRAL_REGION;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={isEditing ? 'Xodim ma\u2019lumotlari' : 'Yangi xodim'}
        description={
          employee
            ? `PINFL: ${employee.pinfl}`
            : 'Yulduzcha bilan belgilanganlar majburiy'
        }
        footer={
          readOnly ? (
            <Button variant="secondary" onClick={onClose}>
              Yopish
            </Button>
          ) : (
            <>
              {isEditing && employee?.isActive && (
                <Button
                  variant="ghost"
                  onClick={() => setConfirmOpen(true)}
                  disabled={saving}
                  className="mr-auto text-[--color-text-muted] hover:text-[--color-expense]"
                >
                  Arxivlash
                </Button>
              )}

              <Button variant="secondary" onClick={onClose} disabled={saving}>
                Bekor qilish
              </Button>

              <Button onClick={() => void handleSave()} loading={saving}>
                Saqlash
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          {serverError && (
            <div className="rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2.5 text-sm text-[--color-expense]">
              {serverError}
            </div>
          )}

          {employee && !employee.isActive && (
            <div className="flex items-center gap-2 rounded-[--radius-control] bg-[--color-surface-sunken] px-3 py-2.5">
              <Badge tone="neutral">Arxivlangan</Badge>
              {employee.firedAt && (
                <span className="text-xs text-[--color-text-muted]">
                  {formatDate(employee.firedAt)}
                </span>
              )}
            </div>
          )}

          {!isEditing && (
            <Input
              label="PINFL"
              value={form.pinfl}
              onChange={(event) =>
                update('pinfl', event.target.value.replace(/\D/g, '').slice(0, 14))
              }
              error={errors.pinfl}
              required
              disabled={saving}
              autoFocus
              placeholder="14 ta raqam"
              className="money"
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Familiya"
              value={form.lastName}
              onChange={(event) => update('lastName', event.target.value)}
              error={errors.lastName}
              required
              disabled={saving || readOnly}
            />

            <Input
              label="Ism"
              value={form.firstName}
              onChange={(event) => update('firstName', event.target.value)}
              error={errors.firstName}
              required
              disabled={saving || readOnly}
            />
          </div>

          <Input
            label="Otasining ismi"
            value={form.middleName}
            onChange={(event) => update('middleName', event.target.value)}
            disabled={saving || readOnly}
          />

          <Select
            label="Ish turi"
            options={employmentTypes}
            value={form.employmentType}
            onChange={(event) =>
              update('employmentType', event.target.value as EmploymentType)
            }
            required
            disabled={saving || readOnly}
          />

          <LocationPicker
            regions={regions}
            regionCode={form.regionCode}
            districtId={form.districtId}
            onRegionChange={(code) => {
              update('regionCode', code);
              // Markazga o'tilsa tuman, viloyatga o'tilsa bo'lim tozalanadi
              if (code === CENTRAL_REGION) {
                update('districtId', null);
              } else {
                update('departmentId', '');
              }
            }}
            onDistrictChange={(id) => update('districtId', id)}
            required
            disabled={saving || readOnly}
            errors={{ region: errors.region, district: errors.district }}
          />

          {isCentral && (
            <Select
              label="Bo&apos;lim"
              options={departmentOptions}
              value={form.departmentId}
              onChange={(event) => update('departmentId', event.target.value)}
              error={errors.departmentId}
              required
              disabled={saving || readOnly}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Lavozim"
              value={form.position}
              onChange={(event) => update('position', event.target.value)}
              disabled={saving || readOnly}
            />

            <Input
              label="Ishga kirgan sana"
              type="date"
              value={form.hiredAt}
              onChange={(event) => update('hiredAt', event.target.value)}
              disabled={saving || readOnly}
            />
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        title="Xodimni arxivlash"
        message={`${employee?.fullName} arxivlansinmi? Ish haqi tarixi saqlanadi, lekin yangi hisoblarda qatnashmaydi.`}
        confirmLabel="Arxivlash"
        danger
        loading={archiving}
        onConfirm={() => void handleArchive()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
