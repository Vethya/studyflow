import { PropsWithChildren } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

import { queryClient } from './query-client';

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'studyflow-mobile-query-cache',
  throttleTime: 1_000,
});

export function PersistedQueryProvider({ children }: PropsWithChildren) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        buster: 'mobile-v1',
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
