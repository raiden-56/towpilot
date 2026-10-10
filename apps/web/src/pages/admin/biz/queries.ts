import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { EmployeeLite, FleetAccountRow, ServiceCategoryRow, ZoneRow } from './types';

export const useCategories = (enabled = true) => useQuery({ queryKey: ['admin', 'pricing', 'categories'], queryFn: () => api.get<ServiceCategoryRow[]>('/admin/pricing/categories'), enabled, staleTime: 60_000 });
export const useZones = (enabled = true) => useQuery({ queryKey: ['admin', 'pricing', 'zones'], queryFn: () => api.get<ZoneRow[]>('/admin/pricing/zones'), enabled, staleTime: 60_000 });

/** All fleet accounts (first 100) — used to list contracts for contract-specific rate cards. */
export const useFleetAccountsAll = (enabled = true) => useQuery({ queryKey: ['admin', 'fleet-accounts', 'all'], queryFn: () => api.page<FleetAccountRow>('/admin/fleet-accounts', { pageSize: 100 }), enabled, staleTime: 60_000 });

/** Field workers (drivers + recovery workers) for payroll pickers. */
export function useFieldWorkers(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'employees', 'field-workers'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const [d, w] = await Promise.all([api.page<EmployeeLite>('/admin/employees', { role: 'driver', pageSize: 100 }), api.page<EmployeeLite>('/admin/employees', { role: 'worker', pageSize: 100 })]);
      const map = new Map<string, EmployeeLite>();
      for (const e of [...d.data, ...w.data]) map.set(e.id, e);
      return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
    },
  });
}

export const useTrucksLite = (enabled = true) =>
  useQuery({ queryKey: ['admin', 'fleet', 'trucks', 'lite'], queryFn: () => api.page<{ id: string; registrationNumber: string; truckType: string }>('/admin/fleet/trucks', { pageSize: 100 }), enabled, staleTime: 60_000 });

/** Every fleet contract with its account (for contract-specific rate cards). */
export const useFleetContracts = (enabled = true) =>
  useQuery({ queryKey: ['admin', 'fleet-accounts', 'contracts'], queryFn: () => api.get<{ id: string; name: string; active: boolean; endsAt: string; fleetAccount: { id: string; name: string } }[]>('/admin/fleet-accounts/contracts'), enabled, staleTime: 60_000 });
