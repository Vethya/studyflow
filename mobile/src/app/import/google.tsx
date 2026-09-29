import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { WireCalendarImportResult, WireClassroomImportResult, WireGoogleImportPreview, WireTaskCategory, WireTaskPriority } from '@studyflow/api';
import { queryKeys } from '@studyflow/api';

import { apiRequest } from '../../lib/api-client';

WebBrowser.maybeCompleteAuthSession();

type ImportSource = 'google_calendar' | 'google_classroom';
type ImportResult = { source: 'google_calendar'; result: WireCalendarImportResult } | { source: 'google_classroom'; result: WireClassroomImportResult };

const categories: WireTaskCategory[] = ['assignment', 'reading', 'exam_preparation', 'project', 'research_writing', 'other'];
const priorities: WireTaskPriority[] = ['low', 'medium', 'high'];

export default function GoogleImportScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<ImportSource | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [classroomDrafts, setClassroomDrafts] = useState<Record<string, { category: WireTaskCategory; priority: WireTaskPriority; estimate: string }>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const previewQuery = useQuery({
    queryKey: ['studyflow', 'google-import', snapshotId],
    queryFn: ({ signal }) => apiRequest<WireGoogleImportPreview>('/integrations/google/imports/' + snapshotId, { signal }),
    enabled: Boolean(snapshotId),
  });
  const preview = previewQuery.data;

  const startImport = async (nextSource: ImportSource) => {
    setSource(nextSource);
    setSnapshotId(null);
    setSelectedIds([]);
    setClassroomDrafts({});
    setResult(null);
    setError(null);
    try {
      const started = await apiRequest<{ authorization_url: string }>('/integrations/google/mobile/start', {
        method: 'POST',
        body: JSON.stringify({ source: nextSource, horizon_days: 28 }),
      });
      const result = await WebBrowser.openAuthSessionAsync(started.authorization_url, 'studyflow://import/google');
      if (result.type !== 'success') throw new Error('Google import was cancelled');
      const query = Linking.parse(result.url).queryParams ?? {};
      const value = (key: string) => {
        const item = query[key];
        return Array.isArray(item) ? item[0] : item;
      };
      const returnedError = value('error');
      if (typeof returnedError === 'string') throw new Error('Google import failed: ' + returnedError);
      const returnedSnapshotId = value('snapshot_id');
      if (typeof returnedSnapshotId !== 'string') throw new Error('Google import did not return a preview');
      setSnapshotId(returnedSnapshotId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not start Google import');
    }
  };

  const items = useMemo(() => preview?.items ?? [], [preview?.items]);
  const selectableIds = useMemo(
    () => items.filter((item) => preview?.source === 'google_calendar' ? item.status !== 'unchanged' : item.status !== 'already_imported').map((item) => item.id),
    [items, preview?.source],
  );

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selectAll = () => setSelectedIds((current) => current.length === selectableIds.length ? [] : selectableIds);
  const classroomDraft = (id: string, suggested: WireTaskCategory) => classroomDrafts[id] ?? { category: suggested, priority: 'medium', estimate: '60' };
  const updateClassroomDraft = (id: string, suggested: WireTaskCategory, patch: Partial<{ category: WireTaskCategory; priority: WireTaskPriority; estimate: string }>) => setClassroomDrafts((current) => ({ ...current, [id]: { ...classroomDraft(id, suggested), ...patch } }));

  const confirmImport = async () => {
    if (!preview || !selectedIds.length) return;
    setSubmitting(true);
    setError(null);
    try {
      if (preview.source === 'google_calendar') {
        const imported = await apiRequest<WireCalendarImportResult>('/integrations/google/imports/' + preview.id + '/calendar', {
          method: 'POST',
          body: JSON.stringify({ item_ids: selectedIds }),
        });
        setResult({ source: 'google_calendar', result: imported });
      } else {
        const imported = await apiRequest<WireClassroomImportResult>('/integrations/google/imports/' + preview.id + '/classroom', {
          method: 'POST',
          body: JSON.stringify({ items: selectedIds.map((id) => { const item = items.find((candidate) => candidate.id === id); const draft = classroomDraft(id, item && 'suggested_category' in item ? item.suggested_category : 'assignment'); return { id, category: draft.category, priority: draft.priority, estimate_minutes: Number(draft.estimate) }; }) }),
        });
        setResult({ source: 'google_classroom', result: imported });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      await queryClient.invalidateQueries({ queryKey: queryKeys.availability });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not finish import');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <View className="flex-row items-center gap-4">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70" onPress={() => router.back()}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <Text className="text-3xl font-bold text-ink">Google imports</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 24, paddingBottom: 32 }}>
        {result ? <ImportResultView result={result} onDone={() => router.back()} /> : null}
        {!preview ? <Text className="text-base leading-6 text-muted">Import coursework and events into StudyFlow. Nothing is added until you review and confirm it.</Text> : null}
        {!result && !preview && !source ? (
          <>
            <ImportCard title="Import calendar events" description="Find events that may affect your available study time." label="Google Calendar" onPress={() => startImport('google_calendar')} />
            <ImportCard title="Import coursework" description="Review active coursework and choose which items become tasks." label="Google Classroom" onPress={() => startImport('google_classroom')} />
          </>
        ) : null}
        {!result && source && !preview && !error ? <ActivityIndicator className="mt-12" color="#9BE15D" /> : null}
        {!result && previewQuery.isPending ? <ActivityIndicator className="mt-8" color="#9BE15D" /> : null}
        {!result && preview ? (
          <>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-xl font-bold text-ink">Review import</Text>
                <Text className="mt-1 text-sm text-muted">Choose what to add to StudyFlow.</Text>
              </View>
              <Pressable className="rounded-full bg-surface px-4 py-2 active:opacity-70" onPress={selectAll}>
                <Text className="font-semibold text-muted">{selectedIds.length === selectableIds.length ? 'Clear' : 'Select all'}</Text>
              </Pressable>
            </View>
            <View className="mt-5 gap-3">
              {items.map((item) => {
                const disabled = item.status === 'unchanged' || item.status === 'already_imported';
                const classroomItem = 'suggested_category' in item ? item : null;
                return (
                  <Pressable key={item.id} disabled={disabled} className={'rounded-2xl border p-4 ' + (selectedIds.includes(item.id) ? 'border-accent bg-accent/10' : 'border-line bg-surface') + (disabled ? ' opacity-50' : ' active:opacity-70')} onPress={() => toggle(item.id)}>
                    <View className="flex-row items-start justify-between gap-3">
                      <Text className="flex-1 text-base font-semibold text-ink">{item.title}</Text>
                      <Text className="text-accent">{selectedIds.includes(item.id) ? '✓' : ''}</Text>
                    </View>
                    <Text className="mt-2 text-sm text-muted">{'starts_at' in item ? new Date(item.starts_at).toLocaleString() : (item.course ?? 'Course') + ' · due ' + new Date(item.due_at).toLocaleDateString()}</Text>
                    <Text className="mt-2 text-xs capitalize text-muted">{item.status.replace('_', ' ')}</Text>
                    {preview.source === 'google_classroom' && classroomItem && item.status !== 'already_imported' ? (
                      <ClassroomDraftControls draft={classroomDraft(classroomItem.id, classroomItem.suggested_category)} onCategory={(category) => updateClassroomDraft(classroomItem.id, classroomItem.suggested_category, { category })} onPriority={(priority) => updateClassroomDraft(classroomItem.id, classroomItem.suggested_category, { priority })} onEstimate={(estimate) => updateClassroomDraft(classroomItem.id, classroomItem.suggested_category, { estimate })} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            {!items.length ? <Text className="mt-8 text-center text-sm text-muted">No new items were found.</Text> : null}
            <Pressable className={'mt-6 items-center rounded-full py-4 ' + (selectedIds.length ? 'bg-accent active:opacity-80' : 'bg-line')} disabled={!selectedIds.length || submitting} onPress={confirmImport}>
              <Text className={'font-bold ' + (selectedIds.length ? 'text-canvas' : 'text-muted')}>{submitting ? 'Importing…' : 'Add ' + selectedIds.length + ' item' + (selectedIds.length === 1 ? '' : 's')}</Text>
            </Pressable>
          </>
        ) : null}
        {!result && error ? <Text className="mt-5 text-sm leading-5 text-danger">{error}</Text> : null}
        {error && source ? <Pressable className="mt-4 self-start rounded-full bg-surface px-4 py-3 active:opacity-70" onPress={() => { setSource(null); setError(null); }}><Text className="font-semibold text-ink">Choose another import</Text></Pressable> : null}
      </ScrollView>
    </View>
  );
}

function ClassroomDraftControls({ draft, onCategory, onPriority, onEstimate }: { draft: { category: WireTaskCategory; priority: WireTaskPriority; estimate: string }; onCategory: (value: WireTaskCategory) => void; onPriority: (value: WireTaskPriority) => void; onEstimate: (value: string) => void }) {
  return (
    <View className="mt-4 gap-3 border-t border-line pt-3">
      <View className="flex-row gap-2">
        <Pressable className="flex-1 rounded-xl bg-surface px-3 py-2" onPress={() => Alert.alert('Category', undefined, categories.map((value) => ({ text: value.replace('_', ' '), onPress: () => onCategory(value) })))}>
          <Text className="text-xs text-muted">Category</Text><Text className="mt-1 text-sm font-semibold capitalize text-ink">{draft.category.replace('_', ' ')}</Text>
        </Pressable>
        <Pressable className="flex-1 rounded-xl bg-surface px-3 py-2" onPress={() => Alert.alert('Priority', undefined, priorities.map((value) => ({ text: value, onPress: () => onPriority(value) })))}>
          <Text className="text-xs text-muted">Priority</Text><Text className="mt-1 text-sm font-semibold capitalize text-ink">{draft.priority}</Text>
        </Pressable>
      </View>
      <View>
        <Text className="mb-1 text-xs text-muted">Estimate (minutes)</Text>
        <TextInput value={draft.estimate} onChangeText={onEstimate} keyboardType="number-pad" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink" />
      </View>
    </View>
  );
}

function ImportResultView({ result, onDone }: { result: ImportResult; onDone: () => void }) {
  return (
    <View className="mb-6 rounded-3xl border border-accent/40 bg-accent/10 p-5">
      <Text className="text-xl font-bold text-ink">Import finished</Text>
      {result.source === 'google_calendar' ? (
        <Text className="mt-2 text-sm leading-5 text-muted">{result.result.created} added · {result.result.updated} updated · {result.result.skipped_past} past events skipped.</Text>
      ) : (
        <Text className="mt-2 text-sm leading-5 text-muted">{result.result.created_task_ids.length} tasks added · {result.result.already_imported.length} already in StudyFlow · {result.result.failed.length} not added.</Text>
      )}
      <Pressable className="mt-5 self-start rounded-full bg-accent px-4 py-3 active:opacity-80" onPress={onDone}><Text className="font-semibold text-canvas">Done</Text></Pressable>
    </View>
  );
}

function ImportCard({ label, title, description, onPress }: { label: string; title: string; description: string; onPress: () => void }) {
  return (
    <Pressable className="mt-6 rounded-3xl border border-line bg-surface p-5 active:opacity-80" onPress={onPress}>
      <Text className="text-xs font-semibold uppercase tracking-[2px] text-accent">{label}</Text>
      <Text className="mt-3 text-xl font-bold text-ink">{title}</Text>
      <Text className="mt-2 text-sm leading-5 text-muted">{description}</Text>
      <Text className="mt-5 font-semibold text-accent">Connect and import →</Text>
    </Pressable>
  );
}
