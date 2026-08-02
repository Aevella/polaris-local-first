# Import And Export

## Purpose

Import/export 通过显式、可验证边界，把用户控制的 package 移入或移出当前数据模型。

## Owns

- Package import。
- Package export。
- Import diagnostics。
- Migration checks。
- Data validation。
- 按域原子替换与失败安全。

## Does Not Own

- Ordinary startup truth。
- Ordinary save paths。
- Placeholder replacement data。
- Old-user in-place upgrade promises。

## Contract

导入不是普通启动的一部分。旧数据进入当前系统必须经过：

1. 读取 package。
2. 验证结构和完整性。
3. 迁移到当前 domain rows。
4. 报告诊断和失败状态。
5. 通过当前 repository path 重新读出。

导入不会先清空 KV、LocalData、localStorage 或全部资产。每个 domain 在当前 backend 上用同一事务
写入新行并为 package 中缺席的旧行写 tombstone；某域提交失败时，该域旧数据保持不变。其他域可以
独立成功，但 UI 必须明确显示“完整成功”或“部分成功”及保留的域，不能静默半成功。

资产先按 id staging/upsert，asset domain 未提交时恢复所有触及的 blob。localStorage 替换抛错时恢复
原值。上传诊断只包含 backend、domain/row 数量、失败阶段、完整性状态和匿名指纹，不包含正文、标题、
提示词、附件内容、身份或凭据。

Export 只导出当前事实，不复活退休 store。

## Failure States

- Package body 缺失或不完整。
- Owner/link/reference 对不上。
- Asset metadata 和 blob payload 缺一边。
- Migration 成功写入但 readback 不能证明。
- 导入边界污染 ordinary startup。
- 完整备份 strict read 遇到 incomplete row 必须停止；普通启动则隔离可选坏行、继续加载健康数据。
