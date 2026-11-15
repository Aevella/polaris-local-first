import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  convertChatboxExportBlobToStructuredExportSnapshot
} from '../stores/chatboxImportSource';
import type { ChatboxImportConversionStats } from '../stores/chatboxImportAdapter';
import { buildStructuredExportPackage } from '../stores/storeExportPackage';
import './chatboxConverterPage.css';

type ConversionStatus = 'idle' | 'reading' | 'ready' | 'failed';

type ConvertedFile = {
  name: string;
  url: string;
  size: number;
  stats: ChatboxImportConversionStats;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function buildOutputName(file: File) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const baseName = file.name.replace(/\.(json|zip)$/i, '') || 'chatbox-export';
  return `${baseName}-polaris-import-${timestamp}.zip`;
}

function StatTile(props: { label: string; value: number }) {
  return (
    <div className="converter-stat">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function ChatboxConverterApp() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<ConversionStatus>('idle');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [isDragging, setDragging] = useState(false);
  const [converted, setConverted] = useState<ConvertedFile | null>(null);

  useEffect(() => {
    return () => {
      if (converted?.url) URL.revokeObjectURL(converted.url);
    };
  }, [converted?.url]);

  const convertFile = async (file: File) => {
    setStatus('reading');
    setError('');
    setFileName(file.name);
    setConverted((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });

    try {
      const { snapshot, stats } = await convertChatboxExportBlobToStructuredExportSnapshot(file);
      const exported = await buildStructuredExportPackage(snapshot);
      const outputBlob = exported.blob;
      setConverted({
        name: buildOutputName(file),
        url: URL.createObjectURL(outputBlob),
        size: outputBlob.size,
        stats
      });
      setStatus('ready');
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : '转换失败');
      setStatus('failed');
    }
  };

  const chooseFile = () => inputRef.current?.click();
  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void convertFile(file);
  };
  const onDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void convertFile(file);
  };

  const stats = converted?.stats;

  return (
    <main className="converter-shell">
      <section className="converter-stage">
        <div className="converter-copy">
          <a className="converter-brand" href="/" aria-label="回到 Polaris">
            <img src="/icons/polaris-icon-192.png" alt="" />
            <span>Polaris</span>
          </a>
          <p className="converter-kicker">Chatbox migration</p>
          <h1>Chatbox 转 Polaris</h1>
          <p className="converter-lede">
            把 Chatbox 导出的备份变成 Polaris 可导入的 zip。文件只在这个浏览器里读取和打包。
          </p>
          <div className="converter-badges" aria-label="转换范围">
            <span>文字会话</span>
            <span>分支线程</span>
            <span>本地处理</span>
          </div>
        </div>
        <div
          className={`converter-dropzone${isDragging ? ' is-dragging' : ''}${status === 'ready' ? ' is-ready' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            onChange={onInputChange}
          />
          <div className="converter-dropmark" aria-hidden="true">
            {status === 'ready' ? '✓' : '↥'}
          </div>
          <div className="converter-dropcopy">
            <strong>
              {status === 'reading'
                ? '正在转换'
                : status === 'ready'
                ? '转换完成'
                : '拖入 Chatbox 导出文件'}
            </strong>
            <span>{fileName || '支持当前 chatbox-backup ZIP，也支持旧版 chatbox-exported-data.json'}</span>
          </div>
          <button type="button" className="converter-primary" onClick={chooseFile} disabled={status === 'reading'}>
            <span aria-hidden="true">＋</span>
            选择文件
          </button>
        </div>
      </section>
      <section className="converter-result" aria-live="polite">
        {status === 'idle' && (
          <div className="converter-empty">
            <strong>准备好了</strong>
            <span>转换不会上传备份。新版 ZIP 里的可读取图片、文件、思考内容和分支会随对话一起保留。</span>
          </div>
        )}
        {status === 'reading' && (
          <div className="converter-empty">
            <strong>正在整理会话</strong>
            <span>会话、消息和分支线程会被打包成标准 Polaris 导入 zip。</span>
          </div>
        )}
        {status === 'failed' && (
          <div className="converter-error">
            <strong>没有转过去</strong>
            <span>{error || '文件格式没有被识别。'}</span>
          </div>
        )}
        {status === 'ready' && converted && stats && (
          <>
            <div className="converter-stats">
              <StatTile label="会话" value={stats.sessions} />
              <StatTile label="对话" value={stats.conversations} />
              <StatTile label="消息" value={stats.messages} />
              <StatTile label="分支 / 线程" value={stats.threadConversations + stats.forkConversations} />
            </div>
            <div className="converter-download">
              <div>
                <strong>{converted.name}</strong>
                <span>{formatBytes(converted.size)} · {stats.unsupportedParts} 个无法原样表达的片段已保留为可读说明</span>
              </div>
              <a className="converter-download-button" href={converted.url} download={converted.name}>
                <span aria-hidden="true">↓</span>
                下载 zip
              </a>
            </div>
            <p className="converter-import-hint">
              下载后可在 Polaris 的备份页选择「从备份包恢复数据」。这会按普通备份恢复流程替换当前数据，请先导出现有备份。
            </p>
          </>
        )}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('chatbox-converter-root')!).render(
  <React.StrictMode>
    <ChatboxConverterApp />
  </React.StrictMode>
);
