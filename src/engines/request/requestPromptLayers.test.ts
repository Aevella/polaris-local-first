import { describe, expect, it } from 'vitest';
import { buildAssistantPromptParts } from './requestPromptLayers';

describe('buildAssistantPromptParts', () => {
  it('prepends system identity before persona and capability layers', () => {
    const parts = buildAssistantPromptParts({
      personaPrompt: '你是一个温柔的协作者。',
      personaPromptSource: 'custom',
      templateContext: {
        cur_date: '2026-04-06',
        cur_time: '05:00',
        cur_datetime: '2026-04-06 05:00:00',
        timezone: 'Asia/Shanghai',
        model_id: 'mimo-v2-omni',
        model_name: 'mimo-v2-omni',
        locale: 'zh-CN',
        system_version: 'test',
        device_info: 'test',
        battery_level: '100%',
        nickname: '用户',
        user_name: '用户',
        assistant_name: 'Pharos'
      },
      messages: []
    });

    expect(parts[0]?.name).toBe('system_identity');
    expect(parts[1]?.name).toBe('persona_identity');
    expect(parts.findIndex((part) => part.name === 'system_identity')).toBeLessThan(
      parts.findIndex((part) => part.name === 'persona_identity')
    );
    expect(parts.findIndex((part) => part.name === 'system_identity')).toBeLessThan(
      parts.findIndex((part) => part.name === 'tool_capability')
    );
    expect(parts.findIndex((part) => part.name === 'tool_capability')).toBeLessThan(
      parts.findIndex((part) => part.name === 'tool_catalog_capability')
    );
    expect(parts[0]?.layer).toBe('identity');
    expect(parts[0]?.content).toContain('你是这间房里持续存在的一个“你”');
    expect(parts.map((part) => part.content).join('\n')).not.toContain('当前本地完整时间');
    expect(parts.map((part) => part.content).join('\n')).not.toContain('当前时区');
  });

  it('adds current local time as dynamic request context when enabled', () => {
    const parts = buildAssistantPromptParts({
      personaPrompt: '你是一个温柔的协作者。',
      personaPromptSource: 'custom',
      includeRuntimeClockContext: true,
      templateContext: {
        cur_date: '2026-07-22',
        cur_time: '21:15',
        cur_datetime: '2026-07-22 21:15:30',
        timezone: 'Asia/Shanghai',
        model_id: 'test-model',
        model_name: 'test-model',
        locale: 'zh-CN',
        system_version: 'test',
        device_info: 'test',
        battery_level: '100%',
        nickname: '用户',
        user_name: '用户',
        assistant_name: 'Pharos'
      },
      messages: []
    });

    const runtimeClock = parts.find((part) => part.name === 'runtime_clock_context');
    expect(runtimeClock?.enabled).toBe(true);
    expect(runtimeClock?.layer).toBe('context');
    expect(runtimeClock?.content).toContain('2026-07-22 21:15:30');
    expect(runtimeClock?.content).toContain('Asia/Shanghai');
  });

  it('includes the current task runtime contract before tool capabilities', () => {
    const parts = buildAssistantPromptParts({
      personaPrompt: '你是一个温柔的协作者。',
      personaPromptSource: 'custom',
      templateContext: {
        cur_date: '2026-04-06',
        cur_time: '05:00',
        cur_datetime: '2026-04-06 05:00:00',
        timezone: 'Asia/Shanghai',
        model_id: 'mimo-v2-omni',
        model_name: 'mimo-v2-omni',
        locale: 'zh-CN',
        system_version: 'test',
        device_info: 'test',
        battery_level: '100%',
        nickname: '用户',
        user_name: '用户',
        assistant_name: 'Pharos'
      },
      currentTask: {
        id: 'task-1',
        sourceMessageId: 'user-1',
        goal: '搭一个小 iPhone 界面',
        title: '搭一个小 iPhone 界面',
        mode: 'active',
        status: 'running',
        stage: '开始处理',
        focus: '我先把页面壳起好。',
        next: '等下补样式和脚本。',
        steps: [],
        executions: [{
          id: 'assistant-1',
          assistantMessageId: 'assistant-1',
          toolCallIds: ['tool-call-1'],
          resultMessageIds: ['tool-message-1'],
          pendingProposalIds: [],
          updatedAt: 1
        }],
        createdAt: 1,
        updatedAt: 1
      },
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先把页面壳起好，再接着补样式。',
          timestamp: 1
        },
        {
          id: 'tool-message-1',
          role: 'system',
          content: '已创建工作区文件 · styles.css',
          timestamp: 2,
          origin: 'tool-runtime',
          toolInvocation: {
            id: 'tool-1',
            kind: 'createProjectFile',
            status: 'executed',
            title: '已创建工作区文件',
            summary: '已创建工作区文件 · styles.css'
          }
        }
      ]
    });

    const workRuntime = parts.find((part) => part.name === 'work_runtime_context');
    expect(workRuntime?.content).toContain('当任务状态发生真实变化时');
    expect(workRuntime?.content).toContain('隐藏的 `polaris-task` JSON 代码块');
    expect(workRuntime?.content).toContain('如果状态没变，就安静保留现有 task 账本');
    expect(workRuntime?.content).not.toContain('每次 assistant 回复结尾都必须');
    expect(workRuntime?.layer).toBe('context');
    expect(workRuntime?.content).toContain('`focus` 和 `next`');
    expect(workRuntime?.content).toContain('把下面这些当成你眼前的工作现场');
    expect(workRuntime?.content).toContain('最近一段你自己刚说过：我先把页面壳起好，再接着补样式。');
    expect(workRuntime?.content).toContain('最近一段已经落下：已创建工作区文件 · styles.css');
    expect(workRuntime?.content).toContain('"id": "task-1"');
    expect(workRuntime?.content).not.toContain('tool-message-1');
  });

  it('adds regex trigger context when the latest user message matches a collaborator trigger', () => {
    const parts = buildAssistantPromptParts({
      personaPrompt: '你是一个温柔的协作者。',
      personaPromptSource: 'custom',
      templateContext: {
        cur_date: '2026-04-06',
        cur_time: '05:00',
        cur_datetime: '2026-04-06 05:00:00',
        timezone: 'Asia/Shanghai',
        model_id: 'mimo-v2-omni',
        model_name: 'mimo-v2-omni',
        locale: 'zh-CN',
        system_version: 'test',
        device_info: 'test',
        battery_level: '100%',
        nickname: '用户',
        user_name: '用户',
        assistant_name: 'Pharos'
      },
      regexTriggers: JSON.stringify([{ pattern: '白树', prompt: '带入白树设定' }]),
      messages: [{
        id: 'user-1',
        role: 'user',
        content: '白树落下来了',
        timestamp: 1
      }]
    });

    const triggerContext = parts.find((part) => part.name === 'regex_trigger_context');
    expect(triggerContext?.enabled).toBe(true);
    expect(triggerContext?.content).toContain('带入白树设定');
    expect(triggerContext?.layer).toBe('context');
  });

  it('adds a narrow direct-execution hint for Mimo 2.5 when a write target is already visible', () => {
    const parts = buildAssistantPromptParts({
      personaPrompt: '你是一个温柔的协作者。',
      personaPromptSource: 'custom',
      templateContext: {
        cur_date: '2026-04-06',
        cur_time: '05:00',
        cur_datetime: '2026-04-06 05:00:00',
        timezone: 'Asia/Shanghai',
        model_id: 'mimo-v2.5-pro',
        model_name: 'mimo-v2.5-pro',
        locale: 'zh-CN',
        system_version: 'test',
        device_info: 'test',
        battery_level: '100%',
        nickname: '用户',
        user_name: '用户',
        assistant_name: 'Pharos'
      },
      toolContext: {
        activeCard: null,
        visibleCards: [],
        visibleProjectFiles: [],
        activeProject: {
          id: 'project-1',
          title: 'Nova Journal',
          slug: 'nova-diary',
          tags: [],
          source: 'manual',
          fileCount: 1,
          files: []
        },
        visibleProjects: [],
        modelTier: 'strong',
        enabledToolGroups: {
          room: true,
          project: true,
          theme: true,
          attachment: true,
          archive: true,
          web: true,
          memory: true
        }
      },
      promptInjections: [{
        name: 'model_runtime_context',
        requiresExecutionTarget: true
      }],
      messages: []
    });

    const modelRuntime = parts.find((part) => part.name === 'model_runtime_context');
    expect(modelRuntime?.enabled).toBe(true);
    expect(modelRuntime?.content).toContain('少思考，直接做');
    expect(modelRuntime?.content).toContain('不要把这一轮停在只读取、只检查、只解释');
    expect(modelRuntime?.content).toContain('完整全文或精确锚点不在上下文时，才需要读取对应文件');
    expect(modelRuntime?.content).toContain('A read-only first turn is unfinished');
  });

  it('does not add the Mimo direct-execution hint for other models', () => {
    const parts = buildAssistantPromptParts({
      personaPrompt: '你是一个温柔的协作者。',
      personaPromptSource: 'custom',
      templateContext: {
        cur_date: '2026-04-06',
        cur_time: '05:00',
        cur_datetime: '2026-04-06 05:00:00',
        timezone: 'Asia/Shanghai',
        model_id: 'deepseek-ai/DeepSeek-V3',
        model_name: 'deepseek-ai/DeepSeek-V3',
        locale: 'zh-CN',
        system_version: 'test',
        device_info: 'test',
        battery_level: '100%',
        nickname: '用户',
        user_name: '用户',
        assistant_name: 'Pharos'
      },
      toolContext: {
        activeCard: null,
        visibleCards: [],
        visibleProjectFiles: [],
        activeProject: {
          id: 'project-1',
          title: 'Nova Journal',
          slug: 'nova-diary',
          tags: [],
          source: 'manual',
          fileCount: 1,
          files: []
        },
        visibleProjects: [],
        modelTier: 'medium',
        enabledToolGroups: {
          room: true,
          project: true,
          theme: true,
          attachment: true,
          archive: true,
          web: true,
          memory: true
        }
      },
      messages: []
    });

    expect(parts.find((part) => part.name === 'model_runtime_context')).toBeUndefined();
  });

  it('adds a read-only work context before the task becomes active', () => {
    const parts = buildAssistantPromptParts({
      personaPrompt: '你是一个温柔的协作者。',
      personaPromptSource: 'custom',
      templateContext: {
        cur_date: '2026-04-06',
        cur_time: '05:00',
        cur_datetime: '2026-04-06 05:00:00',
        timezone: 'Asia/Shanghai',
        model_id: 'mimo-v2-omni',
        model_name: 'mimo-v2-omni',
        locale: 'zh-CN',
        system_version: 'test',
        device_info: 'test',
        battery_level: '100%',
        nickname: '用户',
        user_name: '用户',
        assistant_name: 'Pharos'
      },
      currentTask: {
        id: 'task-seed-1',
        sourceMessageId: 'user-1',
        goal: '帮我做个小页面',
        title: '帮我做个小页面',
        mode: 'seed',
        status: 'running',
        stage: '开始处理',
        steps: [],
        executions: [],
        createdAt: 1,
        updatedAt: 1
      },
      messages: []
    });

    expect(parts.find((part) => part.name === 'task_seed_context')).toBeUndefined();
    expect(parts.find((part) => part.name === 'task_runtime_context')).toBeUndefined();
    const workRuntime = parts.find((part) => part.name === 'work_runtime_context');
    expect(workRuntime?.content).toContain('当前目标：帮我做个小页面');
    expect(workRuntime?.content).toContain('当前阶段：开始处理');
    expect(workRuntime?.content).toContain('只读，不要求你维护 task 账本');
    expect(workRuntime?.content).not.toContain('隐藏的 `polaris-task` JSON 代码块');
    expect(workRuntime?.content).not.toContain('当前任务账本');
  });
});
