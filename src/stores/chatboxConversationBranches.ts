type ChatboxRecord = Record<string, unknown>;

export type ChatboxSavedBranch = {
  idSeed: string;
  titleSuffix: string;
  messages: ChatboxRecord[];
  createdAt: unknown;
};

export type ChatboxSavedBranchCollection = {
  branches: ChatboxSavedBranch[];
  skippedBranchCount: number;
};

function isRecord(value: unknown): value is ChatboxRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function findMessageIndex(messages: ChatboxRecord[], messageId: string) {
  return messages.findIndex((message) => readString(message.id) === messageId);
}

function readForkEntries(session: ChatboxRecord) {
  if (!isRecord(session.messageForksHash)) return [];
  return Object.entries(session.messageForksHash).flatMap(([pivotId, value]) => {
    if (!isRecord(value)) return [];
    return [{ pivotId, fork: value }];
  });
}

function buildBranchPrefix(
  session: ChatboxRecord,
  pivotId: string,
  visiting: ReadonlySet<string>
): ChatboxRecord[] | null {
  const rootMessages = records(session.messages);
  const rootIndex = findMessageIndex(rootMessages, pivotId);
  if (rootIndex >= 0) return rootMessages.slice(0, rootIndex + 1);

  for (const thread of records(session.threads)) {
    const threadMessages = records(thread.messages);
    const threadIndex = findMessageIndex(threadMessages, pivotId);
    if (threadIndex >= 0) return threadMessages.slice(0, threadIndex + 1);
  }

  for (const { pivotId: parentPivotId, fork } of readForkEntries(session)) {
    if (visiting.has(parentPivotId)) continue;
    for (const list of records(fork.lists)) {
      const listMessages = records(list.messages);
      const listIndex = findMessageIndex(listMessages, pivotId);
      if (listIndex < 0) continue;
      const parentPrefix = buildBranchPrefix(
        session,
        parentPivotId,
        new Set([...visiting, parentPivotId])
      );
      if (parentPrefix) return [...parentPrefix, ...listMessages.slice(0, listIndex + 1)];
    }
  }
  return null;
}

export function collectChatboxSavedBranches(session: ChatboxRecord): ChatboxSavedBranchCollection {
  const branches: ChatboxSavedBranch[] = [];
  let skippedBranchCount = 0;
  let ordinal = 0;

  for (const { pivotId, fork } of readForkEntries(session)) {
    for (const [listIndex, list] of records(fork.lists).entries()) {
      const tail = records(list.messages);
      if (tail.length === 0) continue;
      ordinal += 1;
      const prefix = buildBranchPrefix(session, pivotId, new Set([pivotId]));
      if (!prefix) {
        skippedBranchCount += 1;
        continue;
      }
      branches.push({
        idSeed: `${pivotId}:${readString(list.id) || listIndex}`,
        titleSuffix: `分支 ${ordinal}`,
        messages: [...prefix, ...tail],
        createdAt: fork.createdAt
      });
    }
  }

  return { branches, skippedBranchCount };
}
