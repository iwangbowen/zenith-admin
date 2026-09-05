import { useCallback, useEffect, useRef, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { extractPlainText, type ChatMessage as Message } from '../message-adapters';
import { createSpeechRecognition, speakText, type SpeechRecognitionLike } from '../speech';

/** TTS 朗读 assistant 消息 + STT 语音输入草稿；组件卸载时停止朗读 / 录音 */
export function useSpeech() {
  /** TTS 朗读中的消息 ID */
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  /** STT 语音输入 */
  const [recording, setRecording] = useState(false);
  const [sttDraft, setSttDraft] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  /** TTS：朗读 / 停止朗读 assistant 消息 */
  const handleToggleSpeak = useCallback((msg: Message) => {
    if (speakingMsgId === msg.id) {
      window.speechSynthesis?.cancel();
      setSpeakingMsgId(null);
      return;
    }
    const text = extractPlainText(msg);
    if (!text) return;
    const ok = speakText(text, () => setSpeakingMsgId(null));
    if (ok) setSpeakingMsgId(msg.id);
    else Toast.warning('当前浏览器不支持语音朗读');
  }, [speakingMsgId]);

  // 卸载时停止朗读 / 录音
  useEffect(() => () => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
  }, []);

  /** STT：开始 / 停止语音输入（识别文本进入待发草稿条） */
  const handleToggleRecording = useCallback(() => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const rec = createSpeechRecognition();
    if (!rec) {
      Toast.warning('当前浏览器不支持语音识别（建议使用 Chrome / Edge）');
      return;
    }
    recognitionRef.current = rec;
    rec.onresult = (e) => {
      let final = '';
      for (let i = 0; i < e.results.length; i++) {
        final += e.results[i][0]?.transcript ?? '';
      }
      setSttDraft(final);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    rec.start();
    setRecording(true);
  }, [recording]);

  return { speakingMsgId, handleToggleSpeak, recording, sttDraft, setSttDraft, handleToggleRecording };
}
