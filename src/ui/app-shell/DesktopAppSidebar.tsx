import { ConversationMenu } from '../shell/conversation/ConversationMenu';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { CollectionShelf, Persona, World } from '../../types/domain';
import type { ConversationCardSummary } from '../../app/collection/conversationCardSummary';
import { Icon, type IconName } from '../Icon';
import { PersonaAvatar } from '../collaborator/PersonaAvatar';
import { collectionRelativeDateLabel } from '../collection/collectionUtils';
import { useI18n } from '../../i18n';
import { CollaboratorCreatePicker } from '../worlds/chat/collaborator/CollaboratorCreatePicker';

export type DesktopAppSidebarShelfItem = {
  shelf: CollectionShelf;
  label: string;
};

export type DesktopAppSidebarProps = {
  activeWorld: World;
  activeConversationId: string | null;
  collectionShelf: CollectionShelf;
  collaboratorScopeId: string | null;
  currentCollaborator: Persona | null;
  collaborators: Persona[];
  conversations: ConversationCardSummary[];
  shelfItems: DesktopAppSidebarShelfItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectCollaborator: (collaboratorId: string | null) => void;
  onCreateCollaboratorFromBuilder: () => void;
  onCreateCustomCollaborator: () => void;
  onSelectShelf: (shelf: CollectionShelf) => void;
  onOpenConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onToggleConversationPinned: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string, title: string) => void;
  onCreateConversation: () => void;
  onOpenGroupWorld: () => void;
  onOpenSettings: () => void;
};

const SHELF_ICON_BY_ID = {
  project: 'navWorkspace',
  code: 'navCard',
  image: 'navImage',
  info: 'navInfo',
  dialogue: 'navDialogue'
} satisfies Record<CollectionShelf, IconName>;

function sortSidebarConversations(conversations: ConversationCardSummary[]) {
  return [...conversations].sort((left, right) => {
    if (left.pinnedAt && right.pinnedAt) return right.pinnedAt - left.pinnedAt;
    if (left.pinnedAt) return -1;
    if (right.pinnedAt) return 1;
    return right.updatedAt - left.updatedAt;
  });
}

function sortSidebarCollaborators(collaborators: Persona[]) {
  return [...collaborators].sort((left, right) => {
    if (left.pinnedAt && right.pinnedAt) return right.pinnedAt - left.pinnedAt;
    if (left.pinnedAt) return -1;
    if (right.pinnedAt) return 1;
    return left.name.localeCompare(right.name, 'zh-Hans-CN');
  });
}

export function DesktopAppSidebar({
  activeWorld,
  activeConversationId,
  collectionShelf,
  collaboratorScopeId,
  currentCollaborator,
  collaborators,
  conversations,
  shelfItems,
  collapsed,
  onToggleCollapsed,
  onSelectCollaborator,
  onCreateCollaboratorFromBuilder,
  onCreateCustomCollaborator,
  onSelectShelf,
  onOpenConversation,
  onRenameConversation,
  onToggleConversationPinned,
  onDeleteConversation,
  onCreateConversation,
  onOpenGroupWorld,
  onOpenSettings
}: DesktopAppSidebarProps) {
  const { language, t } = useI18n();
  const [collaboratorPickerOpen, setCollaboratorPickerOpen] = useState(false);
  const [collaboratorCreatePickerOpen, setCollaboratorCreatePickerOpen] = useState(false);
  const [actionMenuConversationId, setActionMenuConversationId] = useState<string | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [conversationTitleDraft, setConversationTitleDraft] = useState('');
  const longPressTimerRef = useRef<number | null>(null);
  const suppressNextThreadClickRef = useRef(false);
  const sortedConversations = sortSidebarConversations(conversations);
  const sortedCollaborators = sortSidebarCollaborators(collaborators);
  const hasRoomyCollaboratorPicker = sortedCollaborators.length >= 2;
  const collaboratorName = currentCollaborator?.name.trim() || (collaboratorScopeId ? t('common.collaborator') : t('common.allCollaborators'));
  const collaboratorDescription = currentCollaborator?.description.trim() || t('desktop.switchCollaboratorHint');

  useEffect(() => {
    const liveConversationIds = new Set(conversations.map((conversation) => conversation.id));
    if (actionMenuConversationId && !liveConversationIds.has(actionMenuConversationId)) {
      setActionMenuConversationId(null);
    }
    if (editingConversationId && !liveConversationIds.has(editingConversationId)) {
      setEditingConversationId(null);
      setConversationTitleDraft('');
    }
  }, [actionMenuConversationId, conversations, editingConversationId]);

  const clearLongPress = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const handleSelectCollaborator = (collaboratorId: string | null) => {
    onSelectCollaborator(collaboratorId);
    setCollaboratorPickerOpen(false);
    setCollaboratorCreatePickerOpen(false);
    setActionMenuConversationId(null);
    setEditingConversationId(null);
    setConversationTitleDraft('');
  };
  const openConversationMenu = (conversationId: string) => {
    setCollaboratorPickerOpen(false);
    setCollaboratorCreatePickerOpen(false);
    setActionMenuConversationId((current) => (current === conversationId ? null : conversationId));
  };
  const beginConversationRename = (conversation: ConversationCardSummary) => {
    setActionMenuConversationId(conversation.id);
    setEditingConversationId(conversation.id);
    setConversationTitleDraft(conversation.title);
  };
  const commitConversationRename = (conversationId: string) => {
    const nextTitle = conversationTitleDraft.trim();
    if (!nextTitle) return;
    onRenameConversation(conversationId, nextTitle);
    setEditingConversationId(null);
    setConversationTitleDraft('');
    setActionMenuConversationId(null);
  };
  const cancelConversationRename = () => {
    setEditingConversationId(null);
    setConversationTitleDraft('');
  };
  const handleConversationDelete = (conversation: ConversationCardSummary) => {
    onDeleteConversation(conversation.id, conversation.title);
    setActionMenuConversationId(null);
    if (editingConversationId === conversation.id) {
      setEditingConversationId(null);
      setConversationTitleDraft('');
    }
  };
  const handleThreadPointerDown = (event: PointerEvent, conversationId: string) => {
    clearLongPress();
    if (event.pointerType === 'mouse') return;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      suppressNextThreadClickRef.current = true;
      setActionMenuConversationId(conversationId);
    }, 520);
  };
  const handleThreadPointerEnd = () => {
    clearLongPress();
  };

  return (
    <aside className={`desktop-app-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label={t('desktop.navLabel')}>
      <div className="desktop-app-sidebar-topline">
        <button
          type="button"
          className="desktop-sidebar-collapse-toggle"
          onClick={() => {
            setCollaboratorPickerOpen(false);
            setCollaboratorCreatePickerOpen(false);
            onToggleCollapsed();
          }}
          aria-label={collapsed ? t('desktop.expandSidebar') : t('desktop.collapseSidebar')}
          title={collapsed ? t('desktop.expandSidebarTitle') : t('desktop.collapseSidebarTitle')}
          aria-pressed={collapsed}
        >
          <Icon name="sidebar" size={17} />
        </button>
      </div>

      <button
        type="button"
        className={`desktop-sidebar-collaborator-root ${collaboratorPickerOpen ? 'active' : ''}`}
        onClick={() => {
          if (collaboratorPickerOpen) {
            setCollaboratorCreatePickerOpen(false);
          }
          setCollaboratorPickerOpen((open) => !open);
        }}
        aria-expanded={collaboratorPickerOpen}
      >
        {currentCollaborator ? (
          <PersonaAvatar
            role="assistant"
            seed={currentCollaborator.id}
            assetId={currentCollaborator.assistantAvatarAssetId}
            shape={currentCollaborator.assistantAvatarShape}
            size={28}
          />
        ) : (
          <span className="desktop-sidebar-root-icon" aria-hidden="true">
            <Icon name="persona" size={18} />
          </span>
        )}
        <span className="desktop-sidebar-root-copy">
          <strong>{t('desktop.currentCollaborator')}</strong>
          <small>{collaboratorName}</small>
        </span>
        <Icon name="chevron" size={15} />
      </button>
      {collaboratorPickerOpen ? (
        <div
          className={`desktop-sidebar-collaborator-picker ${hasRoomyCollaboratorPicker ? 'desktop-sidebar-collaborator-picker--roomy' : ''}`}
          role="listbox"
          aria-label={t('desktop.switchCollaborator')}
        >
          <button
            type="button"
            className={`desktop-sidebar-collaborator-option ${collaboratorScopeId === null ? 'active' : ''}`}
            onClick={() => handleSelectCollaborator(null)}
            role="option"
            aria-selected={collaboratorScopeId === null}
          >
            <span className="desktop-sidebar-root-icon" aria-hidden="true">
              <Icon name="persona" size={16} />
            </span>
            <span className="desktop-sidebar-collaborator-option-copy">
              <strong>{t('common.allCollaborators')}</strong>
              <small>{t('desktop.allRooms')}</small>
            </span>
          </button>
          {sortedCollaborators.map((collaborator) => (
            <button
              key={collaborator.id}
              type="button"
              className={`desktop-sidebar-collaborator-option ${collaboratorScopeId === collaborator.id ? 'active' : ''}`}
              onClick={() => handleSelectCollaborator(collaborator.id)}
              role="option"
              aria-selected={collaboratorScopeId === collaborator.id}
            >
              <PersonaAvatar
                role="assistant"
                seed={collaborator.id}
                assetId={collaborator.assistantAvatarAssetId}
                shape={collaborator.assistantAvatarShape}
                size={26}
              />
              <span className="desktop-sidebar-collaborator-option-copy">
                <strong>{collaborator.name}</strong>
                <small>{collaborator.description.trim() || t('desktop.noCollaboratorImpression')}</small>
              </span>
              {collaborator.pinnedAt ? <Icon name="polarisStar" size={11} /> : null}
            </button>
          ))}
          <button
            type="button"
            className={`desktop-sidebar-collaborator-option desktop-sidebar-collaborator-create ${collaboratorCreatePickerOpen ? 'active' : ''}`}
            onClick={() => {
              setActionMenuConversationId(null);
              setEditingConversationId(null);
              setConversationTitleDraft('');
              setCollaboratorCreatePickerOpen((open) => !open);
            }}
            aria-expanded={collaboratorCreatePickerOpen}
          >
            <span className="desktop-sidebar-root-icon" aria-hidden="true">
              <Icon name="personaCreate" size={16} />
            </span>
            <span className="desktop-sidebar-collaborator-option-copy">
              <strong>{t('desktop.createCollaborator')}</strong>
              <small>{t('desktop.createCollaboratorDetail')}</small>
            </span>
          </button>
          {collaboratorCreatePickerOpen ? (
            <div className="desktop-sidebar-collaborator-create-picker">
              <CollaboratorCreatePicker
                showCloseButton={false}
                onCloseCreatePicker={() => setCollaboratorCreatePickerOpen(false)}
                onCreateFromBuilder={() => {
                  setCollaboratorPickerOpen(false);
                  setCollaboratorCreatePickerOpen(false);
                  onCreateCollaboratorFromBuilder();
                }}
                onCreateCustomCollaborator={() => {
                  setCollaboratorPickerOpen(false);
                  setCollaboratorCreatePickerOpen(false);
                  onCreateCustomCollaborator();
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <nav className="desktop-sidebar-section" aria-label={t('desktop.roomArea')}>
        <p className="desktop-sidebar-section-label">{t('common.room')}</p>
        <button
          type="button"
          className={`desktop-sidebar-nav-item ${activeWorld === 'group' ? 'active' : ''}`}
          onClick={onOpenGroupWorld}
        >
          <Icon name="navGroup" size={18} />
          <span>{t('app.world.group')}</span>
        </button>
        {shelfItems.map((item) => {
          const active = activeWorld === 'collection' && collectionShelf === item.shelf;
          return (
            <button
              key={item.shelf}
              type="button"
              className={`desktop-sidebar-nav-item ${active ? 'active' : ''}`}
              onClick={() => onSelectShelf(item.shelf)}
            >
              <Icon name={SHELF_ICON_BY_ID[item.shelf]} size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="desktop-sidebar-section desktop-sidebar-threads" aria-label={t('desktop.conversationThreads')}>
        <div className="desktop-sidebar-section-head">
          <p className="desktop-sidebar-section-label">{t('common.conversation')}</p>
          <button
            type="button"
            className="desktop-sidebar-thread-create"
            onClick={onCreateConversation}
            aria-label={t('common.newConversation')}
            title={t('common.newConversation')}
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
        <div className="desktop-sidebar-thread-list">
          {sortedConversations.length > 0 ? (
            sortedConversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              const menuOpen = actionMenuConversationId === conversation.id;
              const editing = editingConversationId === conversation.id;
              return (
                <div
                  key={conversation.id}
                  className={`desktop-sidebar-thread-row ${active ? 'active' : ''} ${conversation.pinnedAt ? 'pinned' : ''} ${menuOpen ? 'menu-open' : ''} ${editing ? 'editing' : ''}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setActionMenuConversationId(conversation.id);
                  }}
                >
                  {editing ? (
                    <div className="desktop-sidebar-thread-edit">
                      <input
                        value={conversationTitleDraft}
                        onChange={(event) => setConversationTitleDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            commitConversationRename(conversation.id);
                          } else if (event.key === 'Escape') {
                            cancelConversationRename();
                          }
                        }}
                        aria-label={t('desktop.renameConversation')}
                        autoFocus
                      />
                      <div className="desktop-sidebar-thread-edit-actions">
                        <button
                          type="button"
                          className="desktop-sidebar-thread-menu-item"
                          onClick={() => commitConversationRename(conversation.id)}
                        >
                          {t('desktop.saveConversationName')}
                        </button>
                        <button
                          type="button"
                          className="desktop-sidebar-thread-menu-item"
                          onClick={cancelConversationRename}
                        >
                          {t('desktop.cancelConversationName')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="desktop-sidebar-thread-body">
                      <button
                        type="button"
                        className="desktop-sidebar-thread"
                        onPointerDown={(event) => handleThreadPointerDown(event, conversation.id)}
                        onPointerMove={handleThreadPointerEnd}
                        onPointerUp={handleThreadPointerEnd}
                        onPointerCancel={handleThreadPointerEnd}
                        onClick={() => {
                          if (suppressNextThreadClickRef.current) {
                            suppressNextThreadClickRef.current = false;
                            return;
                          }
                          onOpenConversation(conversation.id);
                        }}
                      >
                        <span className="desktop-sidebar-thread-title">
                          {conversation.pinnedAt ? <Icon name="polarisStar" size={10} /> : null}
                          <span>{conversation.displayTitle}</span>
                        </span>
                        <span className="desktop-sidebar-thread-meta">
                          {conversation.activeProjectTitle ? (
                            <>
                              <span className="desktop-sidebar-thread-project">{conversation.activeProjectTitle}</span>
                              <span aria-hidden="true"> · </span>
                            </>
                          ) : null}
                          {collectionRelativeDateLabel(conversation.updatedAt, language)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="desktop-sidebar-thread-more"
                        onClick={(event) => {
                          event.stopPropagation();
                          openConversationMenu(conversation.id);
                        }}
                        aria-label={t('desktop.conversationActions', { title: conversation.displayTitle })}
                        title={t('desktop.conversationActionsTitle')}
                        aria-expanded={menuOpen}
                      >
                        <Icon name="more" size={15} />
                      </button>
                    </div>
                  )}
                  {menuOpen && !editing ? (
                    <div className="desktop-sidebar-thread-menu">
                      <button
                        type="button"
                        className="desktop-sidebar-thread-menu-item"
                        onClick={() => {
                          onToggleConversationPinned(conversation.id);
                          setActionMenuConversationId(null);
                        }}
                      >
                        <Icon name="pin" size={13} />
                        <span>{conversation.pinnedAt ? t('desktop.unpinConversation') : t('desktop.pinConversation')}</span>
                      </button>
                      <button
                        type="button"
                        className="desktop-sidebar-thread-menu-item"
                        onClick={() => beginConversationRename(conversation)}
                      >
                        <Icon name="edit" size={13} />
                        <span>{t('desktop.renameConversation')}</span>
                      </button>
                      <ConversationMenu conversationId={conversation.id} className="desktop-sidebar-thread-menu-item" showLabel />
                      <button
                        type="button"
                        className="desktop-sidebar-thread-menu-item danger"
                        onClick={() => handleConversationDelete(conversation)}
                      >
                        <Icon name="x" size={13} />
                        <span>{t('desktop.deleteConversation')}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="desktop-sidebar-thread-empty">{t('desktop.noChats')}</p>
          )}
        </div>
      </section>

      <footer className="desktop-sidebar-footer">
        <button
          type="button"
          className="desktop-sidebar-settings"
          onClick={onOpenSettings}
          aria-label={t('common.settings')}
          title={t('common.settings')}
        >
          <Icon name="settings" size={17} />
          <span>{t('common.settings')}</span>
        </button>
        <p className="desktop-sidebar-collaborator-note">{collaboratorDescription}</p>
      </footer>
    </aside>
  );
}
