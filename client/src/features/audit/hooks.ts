// TanStack Query hooks for /audit.
//
// useAuditEvents(filters) — paginated, filterable event list.
// useAuditActions()       — distinct action list, used to populate the
//                            action filter dropdown.

import { useQuery } from '@tanstack/react-query';

import type { AuditFilters } from './api';
import { fetchAuditActions, fetchAuditEvents } from './api';

const auditKey = (filters: AuditFilters) =>
  ['audit', filters] as const;

const actionsKey = ['audit', 'actions'] as const;

export function useAuditEvents(filters: AuditFilters) {
  return useQuery({
    queryKey: auditKey(filters),
    queryFn: () => fetchAuditEvents(filters),
    staleTime: 15_000,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: actionsKey,
    queryFn: fetchAuditActions,
    staleTime: 5 * 60_000, // actions list is essentially static
  });
}
