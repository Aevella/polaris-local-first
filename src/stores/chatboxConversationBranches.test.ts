import { describe, expect, it } from 'vitest';
import { collectChatboxSavedBranches } from './chatboxConversationBranches';

describe('collectChatboxSavedBranches', () => {
  it('rebuilds nested saved branches with their reachable message prefixes', () => {
    const result = collectChatboxSavedBranches({
      messages: [
        { id: 'root-user', role: 'user' },
        { id: 'root-current', role: 'assistant' }
      ],
      messageForksHash: {
        'root-user': {
          lists: [
            { id: 'active-root', messages: [] },
            {
              id: 'saved-root',
              messages: [
                { id: 'root-alt', role: 'assistant' },
                { id: 'nested-user', role: 'user' }
              ]
            }
          ]
        },
        'nested-user': {
          lists: [
            { id: 'active-nested', messages: [] },
            { id: 'saved-nested', messages: [{ id: 'nested-alt', role: 'assistant' }] }
          ]
        }
      }
    });

    expect(result.skippedBranchCount).toBe(0);
    expect(result.branches.map((branch) => branch.messages.map((message) => message.id))).toEqual([
      ['root-user', 'root-alt', 'nested-user'],
      ['root-user', 'root-alt', 'nested-user', 'nested-alt']
    ]);
  });

  it('reports orphaned saved branches instead of importing context-free tails', () => {
    const result = collectChatboxSavedBranches({
      messages: [],
      messageForksHash: {
        missing: {
          lists: [{ id: 'orphan', messages: [{ id: 'reply', role: 'assistant' }] }]
        }
      }
    });

    expect(result).toEqual({ branches: [], skippedBranchCount: 1 });
  });
});
