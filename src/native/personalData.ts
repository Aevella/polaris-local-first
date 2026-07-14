import { Capacitor, registerPlugin } from '@capacitor/core';

export type NativePersonalDataPermission =
  | 'unavailable'
  | 'notDetermined'
  | 'denied'
  | 'restricted'
  | 'authorized'
  | 'writeOnly';

export type NativePersonalDataCapability = {
  available: boolean;
  permission: NativePersonalDataPermission;
  detail?: string;
};

export type NativePersonalDataStatus = {
  platform: string;
  calendar: NativePersonalDataCapability;
  health: NativePersonalDataCapability;
};

export type NativeCalendarEvent = {
  eventId: string;
  title: string;
  startDate: string;
  endDate: string;
  calendarId: string;
  calendarName: string;
  calendarSource: string;
  calendarSourceType: string;
  allDay: boolean;
  location?: string;
  notes?: string;
};

export type NativeCalendar = {
  calendarId: string;
  calendarName: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  isDefault: boolean;
  allowsContentModifications: boolean;
};

type NativeCalendarsPayload = {
  summary: string;
  detailText: string;
  calendars: NativeCalendar[];
};

export type NativeCalendarsResult = NativeCalendarsPayload & {
  ok: true;
};

type NativeCalendarEventsPayload = {
  summary: string;
  detailText: string;
  events: NativeCalendarEvent[];
};

export type NativeCalendarEventsResult = NativeCalendarEventsPayload & {
  ok: true;
};

type NativeCalendarMutationPayload = {
  summary: string;
  detailText: string;
  event: NativeCalendarEvent;
};

export type NativeCalendarMutationResult = NativeCalendarMutationPayload & {
  ok: true;
};

export type NativeCalendarQuery = {
  startDate?: string;
  endDate?: string;
  query?: string;
  maxEvents?: number;
};

export type NativeCalendarEventDraft = {
  title: string;
  startDate: string;
  endDate?: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  calendarId?: string;
};

export type NativeCalendarEventPatch = Partial<NativeCalendarEventDraft> & {
  eventId: string;
};

export type NativeCalendarEventDelete = {
  eventId: string;
};

type PersonalDataPlugin = {
  getStatus(): Promise<NativePersonalDataStatus>;
  requestCalendarAccess(): Promise<NativePersonalDataStatus>;
  listCalendars(): Promise<NativeCalendarsPayload>;
  readCalendarEvents(options: NativeCalendarQuery): Promise<NativeCalendarEventsPayload>;
  createCalendarEvent(options: NativeCalendarEventDraft): Promise<NativeCalendarMutationPayload>;
  updateCalendarEvent(options: NativeCalendarEventPatch): Promise<NativeCalendarMutationPayload>;
  deleteCalendarEvent(options: NativeCalendarEventDelete): Promise<NativeCalendarMutationPayload>;
};

const PersonalData = registerPlugin<PersonalDataPlugin>('PersonalData');

let cachedStatus: NativePersonalDataStatus | null = null;

function unavailableStatus(): NativePersonalDataStatus {
  const platform = Capacitor.getPlatform();
  const detail = platform === 'ios'
    ? '当前 iOS 包还没有接入 PersonalData 原生插件。'
    : '当前平台暂未接入系统日历原生桥。';
  return {
    platform,
    calendar: {
      available: false,
      permission: 'unavailable',
      detail
    },
    health: {
      available: false,
      permission: 'unavailable',
      detail: '这版暂未开放健康资料工具。'
    }
  };
}

export function canUseNativePersonalData() {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform()
    && (platform === 'ios' || platform === 'android')
    && Capacitor.isPluginAvailable('PersonalData');
}

export function getCachedNativePersonalDataStatus(): NativePersonalDataStatus {
  if (!canUseNativePersonalData()) return unavailableStatus();
  return cachedStatus ?? {
    platform: Capacitor.getPlatform(),
    calendar: {
      available: true,
      permission: 'notDetermined'
    },
    health: {
      available: false,
      permission: 'unavailable',
      detail: '这版暂未开放健康资料工具。'
    }
  };
}

export function getNativePersonalDataToolAvailability() {
  const status = getCachedNativePersonalDataStatus();
  const calendarWriteAvailable = status.calendar.available
    && status.calendar.permission !== 'denied'
    && status.calendar.permission !== 'restricted'
    && status.calendar.permission !== 'unavailable';
  return {
    calendarAvailable: status.calendar.available
      && status.calendar.permission !== 'denied'
      && status.calendar.permission !== 'restricted'
      && status.calendar.permission !== 'writeOnly',
    calendarWriteAvailable,
    status
  };
}

export async function refreshNativePersonalDataStatus() {
  if (!canUseNativePersonalData()) {
    cachedStatus = unavailableStatus();
    return cachedStatus;
  }
  cachedStatus = await PersonalData.getStatus();
  return cachedStatus;
}

export async function requestNativeCalendarAccess() {
  if (!canUseNativePersonalData()) return unavailableStatus();
  cachedStatus = await PersonalData.requestCalendarAccess();
  return cachedStatus;
}

export async function readNativeCalendarEvents(options: NativeCalendarQuery = {}) {
  if (!canUseNativePersonalData()) {
    throw new Error('当前平台暂未接入系统日历读取。');
  }
  const status = await refreshNativePersonalDataStatus();
  if (status.calendar.permission === 'notDetermined') {
    await requestNativeCalendarAccess();
  }
  const result = await PersonalData.readCalendarEvents(options);
  await refreshNativePersonalDataStatus();
  return {
    ok: true as const,
    ...result
  };
}

export async function listNativeCalendars() {
  if (!canUseNativePersonalData()) {
    throw new Error('当前平台暂未接入系统日历读取。');
  }
  const status = await refreshNativePersonalDataStatus();
  if (status.calendar.permission === 'notDetermined') {
    await requestNativeCalendarAccess();
  }
  const result = await PersonalData.listCalendars();
  await refreshNativePersonalDataStatus();
  return {
    ok: true as const,
    ...result
  };
}

export async function createNativeCalendarEvent(options: NativeCalendarEventDraft) {
  if (!canUseNativePersonalData()) {
    throw new Error('当前平台暂未接入系统日历写入。');
  }
  const status = await refreshNativePersonalDataStatus();
  if (status.calendar.permission === 'notDetermined') {
    await requestNativeCalendarAccess();
  }
  const result = await PersonalData.createCalendarEvent(options);
  await refreshNativePersonalDataStatus();
  return {
    ok: true as const,
    ...result
  };
}

export async function updateNativeCalendarEvent(options: NativeCalendarEventPatch) {
  if (!canUseNativePersonalData()) {
    throw new Error('当前平台暂未接入系统日历写入。');
  }
  const status = await refreshNativePersonalDataStatus();
  if (status.calendar.permission === 'notDetermined') {
    await requestNativeCalendarAccess();
  }
  const result = await PersonalData.updateCalendarEvent(options);
  await refreshNativePersonalDataStatus();
  return {
    ok: true as const,
    ...result
  };
}

export async function deleteNativeCalendarEvent(options: NativeCalendarEventDelete) {
  if (!canUseNativePersonalData()) {
    throw new Error('当前平台暂未接入系统日历写入。');
  }
  const status = await refreshNativePersonalDataStatus();
  if (status.calendar.permission === 'notDetermined') {
    await requestNativeCalendarAccess();
  }
  const result = await PersonalData.deleteCalendarEvent(options);
  await refreshNativePersonalDataStatus();
  return {
    ok: true as const,
    ...result
  };
}
