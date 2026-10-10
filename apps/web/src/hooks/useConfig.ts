import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { AppConfig } from '@/api/types';

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api.get<AppConfig>('/catalog/config'), staleTime: 5 * 60_000 });
}
