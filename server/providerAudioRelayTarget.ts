import { lookup } from 'node:dns/promises';
import { isProviderAudioRelayTarget } from '../src/engines/chat-api/providerAudioRelayShared.js';
import { isPrivateHostname } from '../src/engines/chat-api/providerRelayShared.js';

type RelayAddressRecord = {
  address: string;
};

type ProviderAudioRelayTargetOptions = {
  lookupAddress?: (hostname: string) => Promise<RelayAddressRecord[]>;
};

export class ProviderAudioRelayTargetError extends Error {
  constructor(message = '语音 relay 只接受公开 HTTPS 的语音生成、MiniMax 音色管理、FishAudio /tts 或 /text-to-speech/{voice_id} 接口。') {
    super(message);
    this.name = 'ProviderAudioRelayTargetError';
  }
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function isPrivateRelayAddress(address: string) {
  return isPrivateHostname(normalizeAddress(address));
}

async function resolveRelayAddresses(hostname: string) {
  try {
    return await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ProviderAudioRelayTargetError('语音 relay 目标域名无法解析。');
  }
}

export async function validateProviderAudioRelayTarget(
  endpoint: string,
  options: ProviderAudioRelayTargetOptions = {}
) {
  if (!isProviderAudioRelayTarget(endpoint)) {
    throw new ProviderAudioRelayTargetError();
  }

  const parsed = new URL(endpoint);
  const hostname = normalizeAddress(parsed.hostname);
  if (isPrivateRelayAddress(hostname)) {
    throw new ProviderAudioRelayTargetError('语音 relay 目标不能是本地或内网地址。');
  }

  const lookupAddress = options.lookupAddress ?? resolveRelayAddresses;
  const addresses = await lookupAddress(hostname);
  if (!addresses.length || addresses.some((record) => isPrivateRelayAddress(record.address))) {
    throw new ProviderAudioRelayTargetError('语音 relay 目标解析到了本地或内网地址。');
  }

  return endpoint;
}
