import { useEffect, useMemo, useState } from 'react';
import {
  isDeveloperModeEnabled,
  POLARIS_DEVELOPER_MODE_EVENT
} from '../../../../app/developer/developerModeRuntime';
import {
  CARD_GAME_PROMPTS,
  CARD_GAME_PROMPT_CATEGORIES
} from '../../../../config/prompts/cardGamePrompts';
import {
  getToolCommandSuggestions,
  type ToolCommandGroupId
} from '../../../../engines/toolExecutorCommands';
import { useI18n } from '../../../../i18n';

type SlashCommandSuggestionsProps = {
  query: string | null;
  onPick: (insertText: string) => void;
};

export function SlashCommandSuggestions({ query, onPick }: SlashCommandSuggestionsProps) {
  const { t } = useI18n();
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(() => isDeveloperModeEnabled());
  const normalizedQuery = query?.toLowerCase() ?? '';
  const promptLauncherTitle = t('chat.slash.promptLauncherTitle');
  const promptLauncherAliases = [
    promptLauncherTitle.toLowerCase(),
    'card game prompts',
    'card',
    'game',
    'prompt',
    '卡片小游戏指令',
    '卡片',
    '小游戏'
  ];
  const showPromptLauncher =
    normalizedQuery === ''
    || promptLauncherAliases.some((alias) => alias.includes(normalizedQuery));

  useEffect(() => {
    const handleDeveloperModeUpdated = () => setDeveloperModeEnabled(isDeveloperModeEnabled());
    window.addEventListener(POLARIS_DEVELOPER_MODE_EVENT, handleDeveloperModeUpdated);
    return () => window.removeEventListener(POLARIS_DEVELOPER_MODE_EVENT, handleDeveloperModeUpdated);
  }, []);

  const suggestions = useMemo(
    () => getToolCommandSuggestions({ includeDeveloperCommands: developerModeEnabled })
      .filter((item) => item.command.slice(1).startsWith(normalizedQuery)),
    [developerModeEnabled, normalizedQuery]
  );
  const groupOrder: ToolCommandGroupId[] = ['conversation', 'switching', 'capture', 'advanced'];
  const groupedSuggestions = groupOrder
    .map((group) => suggestions.filter((item) => item.group === group))
    .filter((items) => items.length > 0);

  useEffect(() => {
    if (query === null || !showPromptLauncher) setPromptMenuOpen(false);
  }, [query, showPromptLauncher]);

  if (query === null || (suggestions.length === 0 && !showPromptLauncher)) return null;

  return (
    <div className={`slash-command-menu ${promptMenuOpen ? 'prompt-library-open' : ''}`} role="listbox" aria-label={t('chat.slash.menuAria')}>
      {showPromptLauncher ? (
        <div className="slash-command-group">
          <button
            type="button"
            className={`slash-command-option slash-prompt-launcher ${promptMenuOpen ? 'active' : ''}`}
            aria-expanded={promptMenuOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPromptMenuOpen((open) => !open)}
          >
            <span className="slash-command-name">{promptLauncherTitle}</span>
            <span className="slash-command-description">{t('chat.slash.promptLauncherDescription')}</span>
          </button>
          {promptMenuOpen ? (
            <div className="slash-prompt-library" role="group" aria-label={t('chat.slash.promptLibraryAria')}>
              {CARD_GAME_PROMPT_CATEGORIES.map((category) => {
                const prompts = CARD_GAME_PROMPTS.filter((item) => item.category === category.id);
                if (prompts.length === 0) return null;
                return (
                  <div className="slash-prompt-category" key={category.id}>
                    <div className="slash-prompt-category-title">{category.title}</div>
                    {prompts.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className="slash-prompt-option"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onPick(item.prompt)}
                      >
                        <span className="slash-prompt-title">{item.title}</span>
                        <span className="slash-prompt-description">{item.description}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {!promptMenuOpen
        ? groupedSuggestions.map((items, groupIndex) => (
            <div
              key={items[0]?.group}
              className={`slash-command-group ${groupIndex > 0 || showPromptLauncher ? 'with-divider' : ''}`}
            >
              {items.map((item) => (
                <button
                  type="button"
                  key={item.command}
                  className="slash-command-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(item.insertText)}
                >
                  <span className="slash-command-name">{item.command}</span>
                  <span className="slash-command-description">{item.description}</span>
                </button>
              ))}
            </div>
          ))
        : null}
    </div>
  );
}
