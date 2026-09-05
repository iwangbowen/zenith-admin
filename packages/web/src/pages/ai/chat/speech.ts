/** 浏览器语音能力适配：TTS 朗读（speechSynthesis）与 STT 语音识别（SpeechRecognition），不支持时返回 false / null */

/** 浏览器 TTS 朗读（不支持时静默） */
export function speakText(text: string, onEnd: () => void): boolean {
  if (!('speechSynthesis' in window) || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text.slice(0, 4000));
  utter.lang = 'zh-CN';
  utter.onend = onEnd;
  utter.onerror = onEnd;
  window.speechSynthesis.speak(utter);
  return true;
}

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function createSpeechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'zh-CN';
  rec.continuous = true;
  rec.interimResults = true;
  return rec;
}
