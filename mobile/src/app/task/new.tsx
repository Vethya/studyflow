import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { queryKeys } from '@studyflow/api';

import { apiRequest } from '../../lib/api-client';

const taskSchema = z.object({
  title: z.string().trim().min(1, 'Enter a task title'),
  course: z.string().trim().optional(),
  notes: z.string().max(2000).optional(),
  category: z.enum(['assignment', 'reading', 'exam_preparation', 'project', 'research_writing', 'other']),
  priority: z.enum(['low', 'medium', 'high']),
  deadline: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid deadline'),
  estimate: z.number().int().positive('Enter the estimated minutes'),
});

type TaskValues = z.infer<typeof taskSchema>;
const defaultDeadline = new Date(Date.now() + 86_400_000).toISOString();

export default function NewTaskScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<TaskValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      course: '',
      category: 'assignment',
      priority: 'medium',
      deadline: defaultDeadline,
      estimate: 60,
    },
  });

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await apiRequest('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: values.title,
          course: values.course || null,
          notes: values.notes || null,
          category: values.category,
          priority: values.priority,
          deadline_at: new Date(values.deadline).toISOString(),
          original_estimate_minutes: values.estimate,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      router.replace('/tasks');
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save task');
    }
  });

  return (
    <View className="flex-1 bg-canvas px-5 pt-16">
      <View className="flex-row items-center gap-4">
        <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-surface" onPress={() => router.back()}>
          <Text className="text-xl text-ink">‹</Text>
        </Pressable>
        <Text className="text-3xl font-bold text-ink">Add task</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 24, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <TaskField control={control} name="title" label="Title" placeholder="Read chapter 4" />
        <TaskField control={control} name="course" label="Course" placeholder="Biology" />
        <TaskField control={control} name="deadline" label="Deadline" placeholder="2026-10-01T18:00:00Z" />
        <TaskField control={control} name="estimate" label="Estimated minutes" placeholder="60" keyboardType="number-pad" />
        <TaskField control={control} name="notes" label="Notes" placeholder="Optional context" multiline />
        <Text className="mb-2 mt-5 text-sm font-semibold text-ink">Category</Text>
        <View className="flex-row flex-wrap gap-2">
          {['assignment', 'reading', 'exam_preparation', 'project', 'research_writing', 'other'].map((category) => (
            <Controller
              key={category}
              control={control}
              name="category"
              render={({ field: { onChange, value } }) => (
                <Pressable className={`rounded-full px-4 py-3 ${value === category ? 'bg-accent' : 'bg-surface'}`} onPress={() => onChange(category)}>
                  <Text className={`text-xs font-semibold ${value === category ? 'text-canvas' : 'text-muted'}`}>{category.replace('_', ' ')}</Text>
                </Pressable>
              )}
            />
          ))}
        </View>
        <Text className="mb-2 mt-5 text-sm font-semibold text-ink">Priority</Text>
        <View className="flex-row gap-2">
          {['low', 'medium', 'high'].map((priority) => (
            <Controller
              key={priority}
              control={control}
              name="priority"
              render={({ field: { onChange, value } }) => (
                <Pressable className={`rounded-full px-4 py-3 ${value === priority ? 'bg-accent' : 'bg-surface'}`} onPress={() => onChange(priority)}>
                  <Text className={`text-xs font-semibold capitalize ${value === priority ? 'text-canvas' : 'text-muted'}`}>{priority}</Text>
                </Pressable>
              )}
            />
          ))}
        </View>
        {serverError ? <Text className="mt-5 text-sm leading-5 text-danger">{serverError}</Text> : null}
        <Pressable className="mt-8 items-center rounded-full bg-accent py-4 active:opacity-80" disabled={formState.isSubmitting} onPress={submit}>
          <Text className="font-bold text-canvas">{formState.isSubmitting ? 'Saving…' : 'Save task'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function TaskField({ control, name, label, placeholder, keyboardType, multiline }: { control: any; name: 'title' | 'course' | 'deadline' | 'estimate' | 'notes'; label: string; placeholder: string; keyboardType?: 'number-pad'; multiline?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState }) => (
        <View className="mb-5">
          <Text className="mb-2 text-sm font-semibold text-ink">{label}</Text>
          <TextInput value={String(value ?? '')} onBlur={onBlur} onChangeText={(text) => onChange(name === 'estimate' ? Number(text) : text)} placeholder={placeholder} placeholderTextColor="#78818E" keyboardType={keyboardType} multiline={multiline} className="rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink" />
          {fieldState.error ? <Text className="mt-2 text-xs text-danger">{fieldState.error.message}</Text> : null}
        </View>
      )}
    />
  );
}
