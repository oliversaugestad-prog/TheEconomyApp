import type { AppData } from '../domain/types';
import { supabase } from '../backend/supabase';
import type { Repository } from './repository';

/**
 * Lagring i Supabase (tabellen user_state, beskyttet med radnivåsikkerhet slik at
 * bare eieren kan lese og skrive sin egen rad). Endringer samles og lagres litt
 * forsinket, og tvinges ut når fanen lukkes eller skjules.
 */

export const SAVE_ERROR_EVENT = 'saldo:save-error';

export async function loadRemote(userId: string): Promise<AppData | null> {
  const { data, error } = await supabase().from('user_state').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Kunne ikke hente dataene dine fra serveren.');
  const d = data?.data as AppData | undefined;
  return d && d.version === 1 ? d : null;
}

export function remoteRepository(userId: string, initial: AppData | null): Repository {
  let current = initial;
  let pending: AppData | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const data = pending;
    pending = null;
    if (!data) return;
    const { error } = await supabase()
      .from('user_state')
      .upsert({ user_id: userId, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
      pending = pending ?? data; // prøv igjen ved neste endring
      window.dispatchEvent(new CustomEvent(SAVE_ERROR_EVENT));
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => void flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
  }

  return {
    load: () => (current ? structuredClone(current) : null),
    save(data) {
      current = data;
      pending = data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), 800);
    },
    clear() {
      current = null;
      pending = null;
      void supabase().from('user_state').delete().eq('user_id', userId);
    },
  };
}
