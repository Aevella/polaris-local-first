import { describe, expect, it, vi } from 'vitest';
import {
  buildVoiceGenerationEndpoint,
  requestGeneratedSpeech
} from './voiceGenerationClient';

const voiceSettings = {
  enabled: true,
  providerType: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  path: '/chat/completions',
  apiKey: 'sk-test',
  model: 'tts-1',
  voice: 'alloy' as const,
  format: 'mp3' as const
};

describe('buildVoiceGenerationEndpoint', () => {
  it('routes OpenAI-compatible chat paths to audio/speech', () => {
    expect(buildVoiceGenerationEndpoint(voiceSettings)).toBe('https://api.example.com/v1/audio/speech');
    expect(buildVoiceGenerationEndpoint({
      ...voiceSettings,
      path: '/responses'
    })).toBe('https://api.example.com/v1/audio/speech');
  });

  it('routes MiniMax voice settings to t2a_v2', () => {
    expect(buildVoiceGenerationEndpoint({
      ...voiceSettings,
      providerType: 'minimax'
    })).toBe('https://api.example.com/v1/t2a_v2');
    expect(buildVoiceGenerationEndpoint({
      ...voiceSettings,
      providerType: 'minimax',
      path: '/t2a_v2'
    })).toBe('https://api.example.com/v1/t2a_v2');
  });

  it('routes ElevenLabs voice settings to text-to-speech voice endpoints', () => {
    expect(buildVoiceGenerationEndpoint({
      ...voiceSettings,
      providerType: 'elevenlabs',
      baseUrl: 'https://api.elevenlabs.io/v1'
    })).toBe('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb');
    expect(buildVoiceGenerationEndpoint({
      ...voiceSettings,
      providerType: 'elevenlabs',
      baseUrl: 'https://api.elevenlabs.io/v1',
      path: '/text-to-speech/old-voice',
      voice: 'new voice/id'
    })).toBe('https://api.elevenlabs.io/v1/text-to-speech/new%20voiceid');
  });

  it('routes FishAudio voice settings to tts endpoints', () => {
    expect(buildVoiceGenerationEndpoint({
      ...voiceSettings,
      providerType: 'fishaudio',
      baseUrl: 'https://api.fish.audio/v1'
    })).toBe('https://api.fish.audio/v1/tts');
    expect(buildVoiceGenerationEndpoint({
      ...voiceSettings,
      providerType: 'fishaudio',
      baseUrl: 'https://api.fish.audio',
      path: '/v1/tts'
    })).toBe('https://api.fish.audio/v1/tts');
  });
});

describe('requestGeneratedSpeech', () => {
  it('requests speech audio and returns a playback-ready blob', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('mp3-bytes', {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' }
    }));

    const result = await requestGeneratedSpeech({
      settings: {
        ...voiceSettings
      },
      text: '晚安。',
      fetchImpl: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/audio/speech', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-test'
      }
    }));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toEqual({
      model: 'tts-1',
      input: '晚安。',
      voice: 'alloy',
      response_format: 'mp3'
    });
    expect(result.mimeType).toBe('audio/mpeg');
    expect(await result.blob.text()).toBe('mp3-bytes');
  });

  it('requests MiniMax speech and decodes hex audio', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: {
        audio: '6d70332d6279746573'
      },
      base_resp: {
        status_code: 0,
        status_msg: 'success'
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const result = await requestGeneratedSpeech({
      settings: {
        ...voiceSettings,
        providerType: 'minimax',
        path: '/t2a_v2',
        model: 'speech-2.8-turbo',
        voice: 'Chinese (Mandarin)_Warm_Girl',
        format: 'mp3'
      },
      text: '晚安。',
      fetchImpl: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/t2a_v2', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-test'
      }
    }));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toEqual({
      model: 'speech-2.8-turbo',
      text: '晚安。',
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: 'Chinese (Mandarin)_Warm_Girl',
        speed: 1,
        vol: 1,
        pitch: 0
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1
      }
    });
    expect(result.mimeType).toBe('audio/mpeg');
    expect(await result.blob.text()).toBe('mp3-bytes');
  });

  it('keeps unicode reply text in the body while keeping headers ASCII-safe', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: {
        audio: '6d70332d6279746573'
      },
      base_resp: {
        status_code: 0
      }
    }), { status: 200 }));

    await requestGeneratedSpeech({
      settings: {
        ...voiceSettings,
        providerType: 'minimax',
        path: '/t2a_v2',
        model: 'speech-2.6-hd',
        voice: 'Swi-jietr-DD1',
        format: 'mp3'
      },
      text: '下午四点零二分，“催睡觉”。 Маленький спутник, пришло время обедать。',
      fetchImpl: fetchMock as typeof fetch
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test'
    });
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody.text).toBe('下午四点零二分，“催睡觉”。 Маленький спутник, пришло время обедать。');
    expect(requestBody.voice_setting.voice_id).toBe('Swi-jietr-DD1');
  });

  it('reports pasted non-header characters in the voice API key before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(requestGeneratedSpeech({
      settings: {
        ...voiceSettings,
        apiKey: 'sk-test零宽'
      },
      text: '晚安。',
      fetchImpl: fetchMock as typeof fetch
    })).rejects.toThrow('语音 API Key 里包含 HTTP 请求头不能发送的字符');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses MiniMax voice defaults instead of OpenAI voice defaults', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: {
        audio: '6d70332d6279746573'
      },
      base_resp: {
        status_code: 0
      }
    }), { status: 200 }));

    await requestGeneratedSpeech({
      settings: {
        ...voiceSettings,
        providerType: 'minimax',
        path: '/t2a_v2',
        model: '',
        voice: 'alloy',
        format: 'mp3'
      },
      text: '晚安。',
      fetchImpl: fetchMock as typeof fetch
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody.model).toBe('speech-2.8-turbo');
    expect(requestBody.voice_setting.voice_id).toBe('Chinese (Mandarin)_Warm_Girl');
  });

  it('requests ElevenLabs speech audio with xi-api-key auth', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('mp3-bytes', {
      status: 200,
      headers: { 'content-type': 'audio/opus' }
    }));

    const result = await requestGeneratedSpeech({
      settings: {
        ...voiceSettings,
        providerType: 'elevenlabs',
        baseUrl: 'https://api.elevenlabs.io/v1',
        path: '/text-to-speech',
        model: 'eleven_flash_v2_5',
        voice: 'JBFqnCBsd6RMkjVDRZzb',
        format: 'opus'
      },
      text: '晚安。',
      fetchImpl: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=opus_48000_128', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': 'sk-test'
      }
    }));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toEqual({
      text: '晚安。',
      model_id: 'eleven_flash_v2_5'
    });
    expect(result.mimeType).toBe('audio/opus');
    expect(await result.blob.text()).toBe('mp3-bytes');
  });

  it('uses ElevenLabs defaults instead of foreign voice defaults', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('mp3-bytes', { status: 200 }));

    await requestGeneratedSpeech({
      settings: {
        ...voiceSettings,
        providerType: 'elevenlabs',
        baseUrl: 'https://api.elevenlabs.io/v1',
        model: '',
        voice: 'alloy',
        format: 'mp3'
      },
      text: '晚安。',
      fetchImpl: fetchMock as typeof fetch
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestUrl).toBe('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128');
    expect(requestBody.model_id).toBe('eleven_multilingual_v2');
  });

  it('requests FishAudio speech with reference_id and model header', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('mp3-bytes', {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' }
    }));

    const result = await requestGeneratedSpeech({
      settings: {
        ...voiceSettings,
        providerType: 'fishaudio',
        baseUrl: 'https://api.fish.audio/v1',
        path: '/tts',
        model: 's2-pro',
        voice: 'ca3007f96ae7499ab87d27ea3599956a',
        format: 'mp3'
      },
      text: '晚安。',
      fetchImpl: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.fish.audio/v1/tts', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-test',
        model: 's2-pro'
      }
    }));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toEqual({
      text: '晚安。',
      reference_id: 'ca3007f96ae7499ab87d27ea3599956a',
      format: 'mp3',
      normalize: true
    });
    expect(result.model).toBe('s2-pro');
    expect(result.voice).toBe('ca3007f96ae7499ab87d27ea3599956a');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(await result.blob.text()).toBe('mp3-bytes');
  });

  it('uses FishAudio defaults and omits reference_id when no voice is selected', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('wav-bytes', { status: 200 }));

    await requestGeneratedSpeech({
      settings: {
        ...voiceSettings,
        providerType: 'fishaudio',
        baseUrl: 'https://api.fish.audio/v1',
        model: '',
        voice: '',
        format: 'wav'
      },
      text: '晚安。',
      fetchImpl: fetchMock as typeof fetch
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestInit?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
      model: 's2-pro'
    });
    expect(requestBody).toEqual({
      text: '晚安。',
      format: 'wav',
      normalize: true
    });
  });
});
