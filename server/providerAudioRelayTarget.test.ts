import { describe, expect, it } from 'vitest';
import { validateProviderAudioRelayTarget } from './providerAudioRelayTarget.js';

describe('validateProviderAudioRelayTarget', () => {
  it('accepts public https speech endpoints after DNS validation', async () => {
    await expect(
      validateProviderAudioRelayTarget('https://relay.example.com/v1/audio/speech', {
        lookupAddress: async () => [{ address: '8.8.8.8' }]
      })
    ).resolves.toBe('https://relay.example.com/v1/audio/speech');
    await expect(
      validateProviderAudioRelayTarget('https://api.minimax.io/v1/t2a_v2', {
        lookupAddress: async () => [{ address: '8.8.4.4' }]
      })
    ).resolves.toBe('https://api.minimax.io/v1/t2a_v2');
    await expect(
      validateProviderAudioRelayTarget('https://api.minimax.io/v1/get_voice', {
        lookupAddress: async () => [{ address: '8.8.4.4' }]
      })
    ).resolves.toBe('https://api.minimax.io/v1/get_voice');
    await expect(
      validateProviderAudioRelayTarget('https://api.minimax.io/v1/voice_design', {
        lookupAddress: async () => [{ address: '8.8.4.4' }]
      })
    ).resolves.toBe('https://api.minimax.io/v1/voice_design');
    await expect(
      validateProviderAudioRelayTarget('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128', {
        lookupAddress: async () => [{ address: '1.1.1.1' }]
      })
    ).resolves.toBe('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128');
    await expect(
      validateProviderAudioRelayTarget('https://api.fish.audio/v1/tts', {
        lookupAddress: async () => [{ address: '1.0.0.1' }]
      })
    ).resolves.toBe('https://api.fish.audio/v1/tts');
  });

  it('rejects non-audio and private targets', async () => {
    await expect(
      validateProviderAudioRelayTarget('https://relay.example.com/v1/chat/completions', {
        lookupAddress: async () => [{ address: '8.8.8.8' }]
      })
    ).rejects.toThrow('语音 relay 只接受公开 HTTPS 的语音生成、MiniMax 音色管理、FishAudio /tts 或 /text-to-speech/{voice_id} 接口。');
    await expect(
      validateProviderAudioRelayTarget('https://relay.example.com/v1/audio/speech', {
        lookupAddress: async () => [{ address: '10.0.0.2' }]
      })
    ).rejects.toThrow('语音 relay 目标解析到了本地或内网地址。');
  });
});
