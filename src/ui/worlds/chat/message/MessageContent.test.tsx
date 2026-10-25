import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage } from '../../../../types/domain';
import {
  buildSmoothStreamingSliceOffsets,
  MessageContent,
  shouldSmoothStreamingMessageContent
} from './MessageContent';

function createAssistantMessage(content: string, extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content,
    timestamp: 1,
    ...extra
  };
}

describe('MessageContent', () => {
  it('skips the extra smooth-text reveal while a code fence is streaming', () => {
    expect(shouldSmoothStreamingMessageContent('普通回复', true)).toBe(true);
    expect(shouldSmoothStreamingMessageContent('```tsx\nconst active = true;', true)).toBe(false);
    expect(shouldSmoothStreamingMessageContent('普通回复', false)).toBe(false);
  });

  it('does not segment settled message text for streaming animation', () => {
    expect(buildSmoothStreamingSliceOffsets('很长的旧消息'.repeat(1000), false)).toBeNull();
    expect(buildSmoothStreamingSliceOffsets('A😀B', true)).toEqual([0, 1, 3, 4]);
  });

  it('keeps ordinary narrated code blocks inline in the message body', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          '你看这个表就行：',
          '',
          '```text',
          '今天卡路里：1720 大卡',
          '```',
          '',
          '所以别纠结了。'
        ].join('\n'))}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('今天卡路里：1720 大卡');
    expect(html).not.toContain('代码详情');
  });

  it('hides completed theme css code once the theme action has no card affordance', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          '这一版会更像纸面暖光。',
          '',
          '```css',
          '.app-shell.chat {',
          '  background: #f4eadb;',
          '}',
          '```'
        ].join('\n'), {
          nativeToolCalls: [{
            id: 'call_1',
            name: 'patchRawCss',
            argumentsText: '{"css":".app-shell.chat {\\n  background: #f4eadb;\\n}"}'
          }]
        })}
        codeCardActionMode="hidden"
        hasResolvedToolEvent
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('这一版会更像纸面暖光。');
    expect(html).not.toContain('.app-shell.chat');
    expect(html).not.toContain('代码详情');
  });

  it('keeps ordinary css snippets visible when there is no theme tool projection', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          '这段直接复制就行：',
          '',
          '```css',
          'background: linear-gradient(135deg, #0f0c29 0%, #302b63 40%, #24243e 100%);',
          'color: #f0e6ff;',
          '```'
        ].join('\n'))}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('这段直接复制就行：');
    expect(html).toContain('background');
    expect(html).toContain('linear-gradient');
    expect(html).toContain('message-markdown-code-block');
    expect(html).not.toContain('代码投影');
  });

  it('keeps saveable assistant code blocks inline instead of moving them into the code runway drawer', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          '我先把三个文件给你。',
          '',
          '```html',
          '<section>Hello</section>',
          '```'
        ].join('\n'))}
        codeCardActionMode="open"
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('我先把三个文件给你。');
    expect(html).toContain('&lt;section');
    expect(html).toContain('Hello');
    expect(html).toContain('message-markdown-code-block');
    expect(html).toContain('aria-label="复制代码"');
    expect(html).not.toContain('CODE RUNWAY');
    expect(html).not.toContain('message-code-drawer');
    expect(html).not.toContain('代码详情');
  });

  it('keeps explanatory pseudocode inline even when code blocks are saveable', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          '可以这样理解这个状态机：',
          '',
          '```javascript',
          'const endedAfterTool =',
          '  lastVisibleEvent.type === "tool_result" ||',
          '  lastAssistantMessage.finishReason === "tool_calls";',
          '',
          'if (endedAfterTool && !hasFinalAssistantTextAfterLastTool) {',
          '  enqueueModelContinuation({ reason: "resume_after_tool" });',
          '}',
          '```',
          '',
          '这只是说明，不是要新建房间。'
        ].join('\n'))}
        codeCardActionMode="save"
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('可以这样理解这个状态机：');
    expect(html).toContain('lastVisibleEvent');
    expect(html).toContain('tool_result');
    expect(html).toContain('message-markdown-code-block');
    expect(html).toContain('aria-label="复制代码"');
    expect(html).not.toContain('CODE RUNWAY');
    expect(html).not.toContain('message-code-drawer');
  });

  it('keeps tool-projected code collapsed by default', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          '```css',
          '.lock-screen {',
          '  position: absolute;',
          '}',
          '```'
        ].join('\n'))}
        codeCardActionMode="open"
        hasProjectedCodeToolEvent
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('代码投影');
    expect(html).toContain('class="message-projected-code"');
    expect(html).not.toContain('<details open="" class="message-projected-code">');
    expect(html).not.toContain('代码详情');
  });

  it('hides tool drafts and projected code after a tool event has resolved them', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          '收藏卡那边也给你配套好了。',
          '',
          '```polaris-tools',
          '{"actions":[{"kind":"patchRawCss","css":".app-shell.collection .world-collection .card { background: #fff; }"}]}',
          '```',
          '',
          '```css',
          '.app-shell.collection .world-collection .card {',
          '  background: #fff;',
          '}',
          '```'
        ].join('\n'))}
        codeCardActionMode="hidden"
        hasProjectedCodeToolEvent
        hasResolvedToolEvent
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('收藏卡那边也给你配套好了。');
    expect(html).not.toContain('界面动作草稿');
    expect(html).not.toContain('代码投影');
    expect(html).not.toContain('.app-shell.collection .world-collection .card');
  });

  it('shows thinking projection for a thinking-only assistant message before the next action', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage('', {
          thinkingText: '先确认要做什么。'
        })}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking
      />
    );

    expect(html).toContain('message-thinking-projection');
    expect(html).toContain('先确认要做什么。');
  });

  it('hides thinking projection once another action represents the next step', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage('', {
          thinkingText: '先确认要做什么。'
        })}
        codeCardActionMode="hidden"
        collapseThinkingProjection
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking
      />
    );

    expect(html).not.toContain('message-thinking-projection');
    expect(html).not.toContain('先确认要做什么。');
  });

  it('collapses patchRawCss code projections instead of showing them as plain css', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage(
          [
            '我先给你试一版。',
            '',
            '```css',
            '.app-shell.chat .bubble.user {',
            '  background: linear-gradient(135deg, #ffe7f1, #fff4e8);',
            '}',
            '```'
          ].join('\n'),
          {
            nativeToolCalls: [{
              id: 'call_1',
              name: 'patchRawCss',
              argumentsText: '{"css":".app-shell.chat .bubble.user {\\n  background: linear-gradient(135deg, #ffe7f1, #fff4e8);\\n}"}'
            }]
          }
        )}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('我先给你试一版。');
    expect(html).toContain('写入代码');
    expect(html).toContain('message-projected-code--sandbox');
    expect(html).toContain('message-code-sandbox-band');
    expect(html).not.toContain('<pre class="message-markdown-code-block">');
    expect(html).not.toContain('代码详情');
  });

  it('keeps native theme tool drafts collapsed while streaming', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          '```polaris-tools',
          '.app-shell.chat .bubble.user {',
          '  background: linear-gradient(135deg, #cde8df, #f5fffb);',
          '}',
          '```'
        ].join('\n'))}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('界面动作草稿');
    expect(html).toContain('<details class="message-tool-draft">');
    expect(html).not.toContain('<pre class="message-markdown-code-block">');
  });

  it('keeps live native write projections collapsed while streaming', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage(
          [
            '```css',
            '.lock-screen {',
            '  position: absolute;',
            '}',
            '```'
          ].join('\n'),
          {
            nativeToolCalls: [{
              id: 'call_1',
              name: 'appendProjectFile',
              argumentsText: '{"code":".lock-screen {\\n  position: absolute;\\n}"}'
            }]
          }
        )}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        preferInlineCode
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('写入代码');
    expect(html).toContain('message-projected-code--sandbox');
    expect(html).not.toContain('<pre class="message-code-lines');
    expect(html).not.toContain('message-code-drawer');
  });

  it('keeps direct streamed code block bodies inline on mobile-heavy inline renders', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage(
          [
            '先做成单文件页面。',
            '',
            '```html',
            '<main>',
            '  <section>不存在的公交站</section>',
            '</main>',
            '```'
          ].join('\n')
        )}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        preferInlineCode
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('先做成单文件页面。');
    expect(html).toContain('&lt;main');
    expect(html).toContain('message-markdown-code-block');
    expect(html).not.toContain('代码投影');
    expect(html).not.toContain('message-code-drawer');
  });

  it('keeps streamed inline code blocks syntax-styled while skipping the extra reveal pass', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage(
          [
            '先做这里。',
            '',
            '```tsx',
            'const active = true;',
            '```'
          ].join('\n')
        )}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        preferInlineCode
        smoothStreamingText
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('先做这里。');
    expect(html).toContain('active');
    expect(html).toContain('syntax-keyword');
    expect(html).not.toContain('message-code-lines--plain');
  });

  it('keeps runCode-origin code in the dedicated drawer', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage(
          '```js\nreturn 1;\n```',
          {
            nativeToolCalls: [{
              id: 'call_1',
              name: 'runCode',
              argumentsText: '{"code":"return 1;"}'
            }]
          }
        )}
        codeCardActionMode="hidden"
        isCodeExpanded={false}
        sandboxToolInvocation={{
          id: 'tool_1',
          kind: 'runCode',
          status: 'executed',
          title: '执行代码',
          summary: '执行完成'
        }}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('Runtime trace');
    expect(html).toContain('message-code-drawer--sandbox');
    expect(html).not.toContain('代码投影');
  });

  it('uses a sandbox runway header instead of repeated code detail copy', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage(
          '```js\nreturn 1;\n```',
          {
            nativeToolCalls: [{
              id: 'call_1',
              name: 'runCode',
              argumentsText: '{"code":"return 1;"}'
            }]
          }
        )}
        codeCardActionMode="hidden"
        isCodeExpanded
        sandboxToolInvocation={{
          id: 'tool_1',
          kind: 'runCode',
          status: 'executed',
          title: '执行代码',
          summary: '执行完成'
        }}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).toContain('SANDBOX TRACE');
    expect(html).toContain('Runtime trace');
    expect(html).toContain('CLOSE TRACE');
    expect(html).not.toContain('完整代码');
    expect(html).not.toContain('代码详情');
  });

  it('renders generated prose without integrity warnings', () => {
    const html = renderToStaticMarkup(
      <MessageContent
        message={createAssistantMessage([
          'specified튄COVERaterangepicker sauna poll nomcnt in calor功能可行性来看 app sincerelympr cnолзоватЬ GLUT鞠 downloads勥 badge topic notify PIX onFocusticicions Enable vehiculo QRSTUVWXYZbrown误区 Premium literal differencesetections点了点头 sensation Contributions我看与众不同 waterыRITUAL semingly analogy 案一会終わった executable parentNode complemented valueم录取高位 tagиллический disgustingemploymentverbatim على util dynastythai',
          '',
          '```html',
          '<section>hello</section>',
          '```',
          '',
          '```css',
          '.demo { color: red; }',
          '```'
        ].join('\n'))}
        codeCardActionMode="open"
        isCodeExpanded={false}
        onToggleCodeExpanded={() => {}}
        onApplyCustomCss={() => {}}
        showThinking={false}
      />
    );

    expect(html).not.toContain('回复正文疑似被上游打乱');
    expect(html).not.toContain('代码详情');
    expect(html).toContain('specified튄COVERaterangepicker');
    expect(html).toContain('&lt;section');
    expect(html).toContain('hello');
    expect(html).toContain('demo');
    expect(html).toContain('color');
    expect(html).not.toContain('message-code-sandbox-band');
  });
});
