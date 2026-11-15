import { useMemo, useState } from 'react';
import { buildMcpHandle } from '../../../../engines/mcpHandle';
import { useI18n } from '../../../../i18n/useI18n';
import type { McpServerConfig } from '../../../../types/domain';
import { Icon } from '../../../Icon';
import { McpServerEditorSheet } from '../../menu/McpServerEditorSheet';
import { type PersonaTabProps } from '../personaUiShared';

export type PersonaMcpSettingsPageProps = PersonaTabProps & {
  mcpServers: McpServerConfig[];
  mcpToolTimeoutSeconds: number;
  onCreateMcpServer: (seed?: Partial<McpServerConfig>) => string;
  onUpdateMcpServer: (serverId: string, patch: Partial<McpServerConfig>) => void;
};

function formatToolCount(server: McpServerConfig) {
  const tools = server.tools ?? [];
  return `${tools.filter((tool) => tool.enabled).length} / ${tools.length}`;
}

export function PersonaMcpSettingsPage({
  activePersona,
  mcpServers,
  mcpToolTimeoutSeconds,
  onCreateMcpServer,
  onUpdateMcpServer,
  onUpdatePersona
}: PersonaMcpSettingsPageProps) {
  const { t, language } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const selectedServerIds = activePersona?.mcp?.serverIds ?? [];
  const selectedIdSet = useMemo(() => new Set(selectedServerIds), [selectedServerIds]);
  const followsGlobal = activePersona?.mcp?.inheritGlobal !== false;
  const selectedServers = useMemo(
    () => mcpServers
      .filter((server) => selectedIdSet.has(server.id))
      .sort((left, right) => left.name.localeCompare(right.name, language)),
    [language, mcpServers, selectedIdSet]
  );
  const availableServers = useMemo(
    () => mcpServers
      .filter((server) => !selectedIdSet.has(server.id))
      .sort((left, right) => left.name.localeCompare(right.name, language)),
    [language, mcpServers, selectedIdSet]
  );
  const activeGlobalCount = mcpServers.filter((server) => server.isActive).length;
  const editingServer = mcpServers.find((server) => server.id === editingServerId) ?? null;

  const setFollowsGlobal = (next: boolean) => {
    onUpdatePersona({ mcp: { inheritGlobal: next } });
  };

  const addServer = (serverId: string) => {
    if (selectedIdSet.has(serverId)) return;
    onUpdatePersona({
      mcp: {
        inheritGlobal: false,
        serverIds: [...selectedServerIds, serverId]
      }
    });
  };

  const removeServer = (serverId: string) => {
    onUpdatePersona({
      mcp: {
        inheritGlobal: false,
        serverIds: selectedServerIds.filter((entry) => entry !== serverId)
      }
    });
  };

  return (
    <div className="persona-mcp-settings-flow">
      <div className="memory-toggle memory-toggle--switch persona-mcp-follow-toggle">
        <div className="memory-toggle-copy">
          <strong>{t('request.mcp.followGlobalTitle')}</strong>
          <span>{t('request.mcp.followGlobalDetail', { enabled: activeGlobalCount, total: mcpServers.length })}</span>
        </div>
        <button
          type="button"
          className={`ps-toggle-sw memory-toggle-switch ${followsGlobal ? 'ps-toggle-sw--on' : ''}`}
          aria-pressed={followsGlobal}
          onClick={() => setFollowsGlobal(!followsGlobal)}
        >
          <span className="ps-toggle-knob" />
        </button>
      </div>

      {!followsGlobal ? (
        <section className="persona-mcp-personal-section">
          <div className="persona-mcp-section-head">
            <div>
              <span>{t('request.mcp.personalSection')}</span>
              <strong>{t('request.mcp.personalSummary', { count: selectedServers.length })}</strong>
            </div>
            <div className="mcp-page-actions persona-mcp-actions">
              <button
                type="button"
                className="mcp-icon-button mcp-page-action-button"
                onClick={() => setPickerOpen((open) => !open)}
                aria-label={t('request.mcp.pickExisting')}
              >
                <Icon name="mcpServer" size={19} />
              </button>
              <button
                type="button"
                className="mcp-icon-button mcp-page-action-button"
                onClick={() => setCreatingOpen(true)}
                aria-label={t('request.mcp.createServer')}
              >
                <Icon name="mcpAdd" size={20} />
              </button>
            </div>
          </div>

          {pickerOpen ? (
            <div className="persona-mcp-picker">
              {availableServers.length > 0 ? availableServers.map((server) => (
                <button type="button" key={server.id} onClick={() => addServer(server.id)}>
                  <span>
                    <strong>{server.name}</strong>
                    <small>@{buildMcpHandle({ handle: server.handle, name: server.name, url: server.url, id: server.id })}</small>
                  </span>
                  <Icon name="plus" size={15} />
                </button>
              )) : (
                <p>{t('request.mcp.noAvailableServers')}</p>
              )}
            </div>
          ) : null}

          {selectedServers.length > 0 ? (
            <div className="mcp-server-list persona-mcp-server-list">
              {selectedServers.map((server) => (
                <div key={server.id} className="mcp-server-card persona-mcp-server-card">
                  <button
                    type="button"
                    className="persona-mcp-card-main"
                    onClick={() => setEditingServerId(server.id)}
                  >
                    <span className="mcp-server-icon">
                      <Icon name="mcpService" size={18} />
                      <span className={`mcp-server-dot ${server.isActive ? 'active' : 'inactive'}`} />
                    </span>
                    <span className="mcp-server-card-copy">
                      <span className="mcp-server-card-title-row">
                        <strong>{server.name}</strong>
                        <span className="mcp-server-handle">@{buildMcpHandle({ handle: server.handle, name: server.name, url: server.url, id: server.id })}</span>
                      </span>
                      <span className="mcp-server-badges">
                        <span className={`mcp-server-badge ${server.isActive ? 'active' : 'inactive'}`}>{server.isActive ? t('settings.mcp.statusEnabled') : t('settings.mcp.statusDisabled')}</span>
                        <span className="mcp-server-badge">{server.transport === 'streamable-http' ? 'HTTP' : 'SSE'}</span>
                        <span className="mcp-server-badge">{t('request.mcp.toolsBadge', { count: formatToolCount(server) })}</span>
                      </span>
                      <span className="mcp-server-url">{server.url}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mcp-icon-button subtle persona-mcp-remove"
                    onClick={() => removeServer(server.id)}
                    aria-label={t('request.mcp.removeServer', { name: server.name })}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mcp-empty-state persona-mcp-empty-state">
              <div className="mcp-empty-state-copy">
                <strong>{t('request.mcp.emptyTitle')}</strong>
                <span>{t('request.mcp.emptyDetail')}</span>
              </div>
              <div className="mcp-empty-state-actions">
                <button type="button" className="mcp-btn secondary" onClick={() => setPickerOpen(true)}>
                  {t('request.mcp.pickExisting')}
                </button>
                <button type="button" className="mcp-btn primary" onClick={() => setCreatingOpen(true)}>
                  {t('request.mcp.createServer')}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <McpServerEditorSheet
        open={creatingOpen}
        server={null}
        timeoutSeconds={mcpToolTimeoutSeconds}
        onClose={() => setCreatingOpen(false)}
        onPersist={(serverId, patch) => {
          if (serverId) {
            onUpdateMcpServer(serverId, patch);
            return serverId;
          }
          const createdServerId = onCreateMcpServer(patch);
          onUpdatePersona({
            mcp: {
              inheritGlobal: false,
              serverIds: Array.from(new Set([...selectedServerIds, createdServerId]))
            }
          });
          return createdServerId;
        }}
      />

      <McpServerEditorSheet
        open={Boolean(editingServer)}
        server={editingServer}
        timeoutSeconds={mcpToolTimeoutSeconds}
        onClose={() => setEditingServerId(null)}
        onPersist={(serverId, patch) => {
          const targetId = serverId ?? editingServer?.id;
          if (!targetId) return '';
          onUpdateMcpServer(targetId, patch);
          return targetId;
        }}
      />
    </div>
  );
}
