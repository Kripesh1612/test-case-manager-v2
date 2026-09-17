// TanStack Query hooks for the webhooks admin page.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { WebhookCreateInput, WebhookUpdateInput } from './api';
import {
  createWebhook,
  deleteWebhook,
  fetchWebhookDeliveries,
  fetchWebhooks,
  testWebhook,
  updateWebhook,
} from './api';

const webhooksKey = ['webhooks'] as const;

const deliveriesKey = (id: number) => ['webhooks', 'deliveries', id] as const;

export function useWebhooks() {
  return useQuery({
    queryKey: webhooksKey,
    queryFn: fetchWebhooks,
    staleTime: 15_000,
  });
}

export function useWebhookDeliveries(id: number | null) {
  return useQuery({
    queryKey: deliveriesKey(id ?? -1),
    queryFn: () => fetchWebhookDeliveries(id as number),
    enabled: id !== null,
    staleTime: 15_000,
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookCreateInput) => createWebhook(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhooksKey }),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookUpdateInput & { id: number }) =>
      updateWebhook(input.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhooksKey }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteWebhook(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: webhooksKey }),
  });
}

export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => testWebhook(id),
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: deliveriesKey(id) }),
  });
}