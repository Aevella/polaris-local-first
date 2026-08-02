# LocalData

## Purpose

LocalData 是应用数据的持久事实合同。产品模块应该通过 domain row writers/readers 读写它，而不是各自拥有一份隐藏事实。

## Owns

- Row states。
- Domain ownership。
- Commit validation。
- Import/promotion invariants。
- Backend abstraction。
- Incomplete、deleted、quarantined、recovered 等状态语义。

## Does Not Own

- UI presentation。
- Provider networking。
- Model request construction。
- Undocumented storage behavior。

## Main Entrypoints

- `src/engines/localData/`
- Domain row writers。
- Data-boundary tests。

## Current Shape

Native iOS/Android 当前通过 startup composition root 安装 SQLite LocalData backend。Web/selfhost 当前仍使用 KV (IndexedDB) 作为当前事实源。导入 package data 通过显式 import/migration/validation/restore 进入当前 rows。

## Important Rule

普通启动只读当前 repository path。旧 store、legacy source、recovery worker 只能在明确 import/migration/recovery/diagnostics 边界里存在，不能继续参与 normal startup、ordinary save 或 current export truth。

完整备份读取使用 strict 语义，任何 active incomplete row 都会阻止导出。普通启动使用 recover 语义：
可选坏行会被隔离，健康行继续加载；坏对话或文档正文保持 failed/incomplete，不能投影成空正文后写回。

## Verification

- `npm run test:data-boundary`
- LocalData row tests under `src/engines/localData/`
- Startup/store boundary tests。
