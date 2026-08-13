import { useMemo, useState } from 'react';
import type { McpServerConfig } from '../../../types/domain';
import { buildMcpHandle } from '../../../engines/mcpHandle';
import { useI18n } from '../../../i18n/useI18n';
import { Icon } from '../../Icon';
import { McpJsonEditorSheet } from './McpJsonEditorSheet';
import { McpServerEditorSheet } from './McpServerEditorSheet';
import { McpTimeoutSheet } from './McpTimeoutSheet';

type MenuMcpPageProps = {
  mcpServers: McpServerConfig[];
  timeoutSeconds: number;
  onBack: () => void;
  onSetTimeoutSeconds: (seconds: number) => void;
  onSetServers: (servers: McpServerConfig[]) => void;
  onCreateServer: (seed?: Partial<McpServerConfig>) => string;
  onUpdateServer: (serverId: string, patch: Partial<McpServerConfig>) => void;
  onDeleteServer: (serverId: string) => void;
};

export function MenuMcpPage({
  mcpServers,
  timeoutSeconds,
  onBack,
  onSetTimeoutSeconds,
  onSetServers,
  onCreateServer,
  onUpdateServer,
  onDeleteServer
}: MenuMcpPageProps) {
  const { t, language } = useI18n();
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [timeoutSheetOpen, setTimeoutSheetOpen] = useState(false);

  const sortedServers = useMemo(
    () => [...mcpServers].sort((left, right) => {
      if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
      return left.name.localeCompare(right.name, language);
    }),
    [language, mcpServers]
  );
  const editingServer = mcpServers.find((server) => server.id === editingServerId) ?? null;
  const inlineSheetOpen = creatingOpen || Boolean(editingServer) || jsonEditorOpen || timeoutSheetOpen;
  const enabledCount = mcpServers.filter((server) => server.isActive).length;

  return (
    <div className={`menu-sheet-page mcp-menu-page ${inlineSheetOpen ? 'mcp-inline-sheet-open' : ''}`}>
      <div className="menu-sheet-header">
        <button type="button" className="menu-sheet-back" aria-label={t('settings.pageBack')} onClick={onBack}>
          <span className="menu-sheet-back-icon"><Icon name="chevron" size={26} /></span>
        </button>
        <div className="menu-sheet-title mcp-page-title-row">
          <div>
            <h2>MCP</h2>
            <p>{t('settings.mcp.pageHelp')}</p>
          </div>
          <div className="mcp-page-actions">
            <button type="button" className="mcp-icon-button mcp-page-action-button" onClick={() => setTimeoutSheetOpen(true)} aria-label={t('settings.mcp.timeoutAction')}>
              <Icon name="mcpTimeout" size={22} />
            </button>
            <button type="button" className="mcp-icon-button mcp-page-action-button" onClick={() => setJsonEditorOpen(true)} aria-label={t('settings.mcp.editJsonAction')}>
              <Icon name="mcpJson" size={22} />
            </button>
            <button type="button" className="mcp-icon-button mcp-page-action-button" onClick={() => setCreatingOpen(true)} aria-label={t('settings.mcp.addAction')}>
              <Icon name="mcpAdd" size={22} />
            </button>
          </div>
        </div>
      </div>

      <details className="mcp-guide" aria-label={t('settings.mcp.guideLabel')}>
        <summary className="mcp-guide-summary">
          <span className="mcp-guide-summary-main">
            <span className="mcp-guide-help-icon"><Icon name="helpCircle" size={17} /></span>
            <span className="mcp-guide-title">{t('settings.mcp.guideTitle')}</span>
          </span>
          <span className="mcp-guide-chevron"><Icon name="chevronDown" size={15} /></span>
        </summary>
        <div className="mcp-guide-grid">
          <div className="mcp-guide-item">
            <span className="mcp-guide-label">{t('settings.mcp.guideCanConnectLabel')}</span>
            <p>{t('settings.mcp.guideCanConnectText')} <code>https://.../mcp</code>{t('settings.mcp.guideExampleSeparator')}<code>http://.../mcp</code>{t('settings.mcp.guideSentenceEnd')}</p>
          </div>
          <div className="mcp-guide-item">
            <span className="mcp-guide-label">{t('settings.mcp.guideCannotConnectLabel')}</span>
            <p>{t('settings.mcp.guideCannotConnectText')} <code>command</code> / <code>args</code> {t('settings.mcp.guideCannotConnectTail')} <code>npx</code>{t('settings.mcp.guideExampleSeparator')}<code>python</code>{t('settings.mcp.guideExampleSeparator')}<code>node</code>{t('settings.mcp.guideSentenceEnd')}</p>
          </div>
          <div className="mcp-guide-item">
            <span className="mcp-guide-label">{t('settings.mcp.guideTroubleshootLabel')}</span>
            <p>{t('settings.mcp.guideTroubleshootText')} <code>initialize</code> {t('settings.mcp.guideAnd')} <code>tools/list</code>{t('settings.mcp.guideClauseBreak')}{t('settings.mcp.guideTroubleshootTail')}</p>
          </div>
        </div>
      </details>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker">{t('settings.mcp.summarySection')}</span>
          <p className="menu-section-note">{t('settings.mcp.summary', { enabled: enabledCount, total: mcpServers.length, seconds: timeoutSeconds })}</p>
        </div>
        {sortedServers.length > 0 ? (
          <div className="mcp-server-list">
            {sortedServers.map((server) => (
              <div
                key={server.id}
                className="mcp-server-card"
                role="button"
                tabIndex={0}
                onClick={() => setEditingServerId(server.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setEditingServerId(server.id);
                  }
                }}
              >
                <div className="mcp-server-card-leading">
                  <span className="mcp-server-icon">
                    <Icon name="mcpService" size={18} />
                    <span className={`mcp-server-dot ${server.isActive ? 'active' : 'inactive'}`} />
                  </span>
                </div>
                <div className="mcp-server-card-copy">
                  <div className="mcp-server-card-title-row">
                    <strong>{server.name}</strong>
                    <span className="mcp-server-handle">@{buildMcpHandle({ handle: server.handle, name: server.name, url: server.url, id: server.id })}</span>
                  </div>
                  <div className="mcp-server-badges">
                    <span className={`mcp-server-badge ${server.isActive ? 'active' : 'inactive'}`}>{server.isActive ? t('settings.mcp.statusEnabled') : t('settings.mcp.statusDisabled')}</span>
                    <span className="mcp-server-badge">{server.transport === 'streamable-http' ? 'HTTP' : 'SSE'}</span>
                    <span className="mcp-server-badge">{t('settings.mcp.toolsCount', {
                      enabled: (server.tools ?? []).filter((tool) => tool.enabled).length,
                      total: (server.tools ?? []).length
                    })}</span>
                    <span className="mcp-server-badge">{t('settings.mcp.headersCount', { count: server.headers.length })}</span>
                  </div>
                  <div className="mcp-server-url">{server.url}</div>
                  {server.description ? <div className="mcp-server-description">{server.description}</div> : null}
                </div>
                <div className="mcp-server-card-side">
                  <button
                    type="button"
                    className={`ps-toggle-sw ${server.isActive ? 'ps-toggle-sw--on' : ''}`}
                    aria-label={t('settings.mcp.toggleAria', { name: server.name, status: server.isActive ? t('settings.mcp.statusEnabled') : t('settings.mcp.statusDisabled') })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onUpdateServer(server.id, { isActive: !server.isActive });
                    }}
                  >
                    <span className="ps-toggle-knob" />
                  </button>
                  <span className="mcp-server-arrow">›</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mcp-empty-state">
            <div className="mcp-empty-state-copy">
              <strong>{t('settings.mcp.emptyTitle')}</strong>
              <span>{t('settings.mcp.emptyDetail')}</span>
            </div>
            <div className="mcp-empty-state-actions">
              <button type="button" className="mcp-btn secondary" onClick={() => setJsonEditorOpen(true)}>
                {t('settings.mcp.editJsonAction')}
              </button>
              <button type="button" className="mcp-btn primary" onClick={() => setCreatingOpen(true)}>
                {t('settings.mcp.addAction')}
              </button>
            </div>
          </div>
        )}
      </section>

      <McpServerEditorSheet
        open={creatingOpen}
        server={null}
        timeoutSeconds={timeoutSeconds}
        onClose={() => setCreatingOpen(false)}
        onSave={(patch) => {
          onCreateServer(patch);
        }}
      />

      <McpServerEditorSheet
        open={Boolean(editingServer)}
        server={editingServer}
        timeoutSeconds={timeoutSeconds}
        onClose={() => setEditingServerId(null)}
        onSave={(patch) => {
          if (!editingServer) return;
          onUpdateServer(editingServer.id, patch);
        }}
        onDelete={
          editingServer
            ? () => {
                if (!window.confirm(t('settings.mcp.confirmDelete', { name: editingServer.name }))) return;
                onDeleteServer(editingServer.id);
                setEditingServerId(null);
              }
            : undefined
        }
      />

      <McpJsonEditorSheet
        open={jsonEditorOpen}
        servers={mcpServers}
        onClose={() => setJsonEditorOpen(false)}
        onSave={onSetServers}
      />

      <McpTimeoutSheet
        open={timeoutSheetOpen}
        timeoutSeconds={timeoutSeconds}
        onClose={() => setTimeoutSheetOpen(false)}
        onSave={onSetTimeoutSeconds}
      />
    </div>
  );
}
