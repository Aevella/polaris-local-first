import { describe, expect, it } from 'vitest';
import {
  isProviderAudioRelayTarget,
  isProviderAudioSpeechRelayTarget,
  isProviderAudioSpeechRequestBody
} from './providerAudioRelayShared';

describe('providerAudioRelayShared', () => {
  it('accepts only public https speech endpoints', () => {
    expect(isProviderAudioSpeechRelayTarget('https://api.example.com/v1/audio/speech')).toBe(true);
    expect(isProviderAudioRelayTarget('https://api.minimax.io/v1/t2a_v2')).toBe(true);
    expect(isProviderAudioRelayTarget('https://api.minimax.io/v1/get_voice')).toBe(true);
    expect(isProviderAudioRelayTarget('https://api.minimax.io/v1/voice_design')).toBe(true);
    expect(isProviderAudioRelayTarget('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128')).toBe(true);
    expect(isProviderAudioSpeechRelayTarget('https://api.example.com/v1/chat/completions')).toBe(false);
    expect(isProviderAudioRelayTarget('https://api.elevenlabs.io/v1/text-to-speech')).toBe(false);
    expect(isProviderAudioSpeechRelayTarget('http://api.example.com/v1/audio/speech')).toBe(false);
    expect(isProviderAudioSpeechRelayTarget('https://127.0.0.1/v1/audio/speech')).toBe(false);
  });

  it('accepts speech request bodies with model, input, and voice', () => {
    expect(isProviderAudioSpeechRequestBody({
      model: 'tts-1',
      input: '晚安。',
      voice: 'alloy',
      response_format: 'mp3'
    })).toBe(true);
    expect(isProviderAudioSpeechRequestBody({ model: '', input: 'x', voice: 'alloy' })).toBe(false);
    expect(isProviderAudioSpeechRequestBody({ model: 'tts-1', input: '', voice: 'alloy' })).toBe(false);
    expect(isProviderAudioSpeechRequestBody({ model: 'tts-1', input: 'x', voice: '' })).toBe(false);
    expect(isProviderAudioSpeechRequestBody({ model: 'tts-1', input: 'x', voice: 'alloy', response_format: '' })).toBe(false);
  });

  it('accepts MiniMax non-streaming hex speech request bodies', () => {
    expect(isProviderAudioSpeechRequestBody({
      model: 'speech-2.8-turbo',
      text: '晚安。',
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: 'Chinese (Mandarin)_Warm_Girl'
      },
      audio_setting: {
        format: 'mp3'
      }
    })).toBe(true);
    expect(isProviderAudioSpeechRequestBody({
      model: 'speech-2.8-turbo',
      text: '晚安。',
      stream: true,
      output_format: 'hex',
      voice_setting: {
        voice_id: 'Chinese (Mandarin)_Warm_Girl'
      },
      audio_setting: {
        format: 'mp3'
      }
    })).toBe(false);
  });

  it('accepts MiniMax voice library and design request bodies', () => {
    expect(isProviderAudioSpeechRequestBody({
      voice_type: 'all'
    })).toBe(true);
    expect(isProviderAudioSpeechRequestBody({
      voice_type: 'unknown'
    })).toBe(false);
    expect(isProviderAudioSpeechRequestBody({
      prompt: '温柔清亮的陪伴女声',
      preview_text: '你好呀。',
      voice_id: 'aa_custom_voice'
    })).toBe(true);
    expect(isProviderAudioSpeechRequestBody({
      prompt: '温柔清亮的陪伴女声',
      preview_text: ''
    })).toBe(false);
  });

  it('accepts ElevenLabs speech request bodies', () => {
    expect(isProviderAudioSpeechRequestBody({
      text: '晚安。',
      model_id: 'eleven_multilingual_v2'
    })).toBe(true);
    expect(isProviderAudioSpeechRequestBody({
      text: '晚安。',
      model_id: ''
    })).toBe(false);
    expect(isProviderAudioSpeechRequestBody({
      text: ''
    })).toBe(false);
  });
});
