// Голосовой ввод для Пина: «еду к театру Абая к 18:40».
// Android — системное распознавание речи (плагин @capacitor-community/speech-recognition, русский язык);
// браузер — Web Speech API, если он есть. Звук никуда не сохраняем: в Пина попадает только распознанный текст.
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

export type VoiceResult = { ok: true; text: string } | { ok: false; why: 'denied' | 'unavailable' | 'nothing' | 'error' };

const native = () => Capacitor.isNativePlatform();
type WebRec = { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; abort(): void; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null };
const webCtor = (): (new () => WebRec) | null =>
  typeof window === 'undefined' ? null : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

export async function voiceAvailable(): Promise<boolean> {
  if (native()) { try { return (await SpeechRecognition.available()).available; } catch { return false; } }
  return !!webCtor();
}

let stopWeb: (() => void) | null = null;

/** Слушает одну фразу и возвращает текст. onPartial — промежуточный текст для поля ввода. */
export async function listenOnce(onPartial?: (t: string) => void): Promise<VoiceResult> {
  if (native()) {
    try {
      let perm = await SpeechRecognition.checkPermissions();
      if (perm.speechRecognition !== 'granted') perm = await SpeechRecognition.requestPermissions();
      if (perm.speechRecognition !== 'granted') return { ok: false, why: 'denied' };
      if (!(await SpeechRecognition.available()).available) return { ok: false, why: 'unavailable' };
      const r = await SpeechRecognition.start({ language: 'ru-RU', maxResults: 1, partialResults: false, popup: true, prompt: 'Скажите, куда едете' });
      const t = r.matches?.[0]?.trim();
      return t ? { ok: true, text: t } : { ok: false, why: 'nothing' };
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      return { ok: false, why: /no match|didn't|not understand|7|nothing/i.test(m) ? 'nothing' : 'error' };
    }
  }
  const C = webCtor();
  if (!C) return { ok: false, why: 'unavailable' };
  return new Promise((done) => {
    const rec = new C();
    rec.lang = 'ru-RU'; rec.interimResults = !!onPartial; rec.maxAlternatives = 1;
    let final = '', settled = false;
    const finish = (r: VoiceResult) => { if (!settled) { settled = true; stopWeb = null; done(r); } };
    rec.onresult = (e: any) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) final = t; }
      onPartial?.(t);
    };
    rec.onerror = (e: any) => finish({ ok: false, why: e?.error === 'not-allowed' || e?.error === 'service-not-allowed' ? 'denied' : e?.error === 'no-speech' ? 'nothing' : 'error' });
    rec.onend = () => finish(final.trim() ? { ok: true, text: final.trim() } : { ok: false, why: 'nothing' });
    stopWeb = () => rec.abort();
    try { rec.start(); } catch { finish({ ok: false, why: 'error' }); }
  });
}

export function stopListening() { stopWeb?.(); if (native()) void SpeechRecognition.stop().catch(() => {}); }

export const VOICE_ERR: Record<Exclude<VoiceResult, { ok: true }>['why'], string> = {
  denied: 'Нет доступа к микрофону — разрешите его в настройках телефона или напишите текстом.',
  unavailable: 'На этом устройстве нет распознавания речи. Напишите Пину текстом.',
  nothing: 'Не расслышал. Нажмите на микрофон и скажите, например: «Еду к театру Абая к 18:40».',
  error: 'Распознавание не сработало. Попробуйте ещё раз или напишите текстом.',
};
