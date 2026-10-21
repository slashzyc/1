# HTTP API 与数据流

所有业务 API 返回 JSON，异常为 `{error:{code,message,requestId}}`。若配置 `APP_TOKEN`，请求附 `Authorization: Bearer ...`。请求体 `application/json`，最大 256 KB。默认绑定 127.0.0.1:3000。

| 方法 | 路径 | 请求／输出 |
|---|---|---|
| GET | `/healthz`、`/readyz` | 进程／数据库健康，仅返回 ok |
| GET | `/api/bootstrap` | 商品、角色、规则、最近任务、工单、统计与审计；无密钥 |
| GET | `/api/config` | 无密钥角色／能力配置 |
| POST | `/api/products/import` | `{products:[完整商品对象]}`；最多100条；事务提交 |
| POST | `/api/runs` | 工作流、商品ID、市场、模式、需求、可选商务字段 |
| POST | `/api/runs/:id/revisions` | `{expectedVersion,prompt,overrides?}`；冲突409 |
| GET | `/api/runs/:id` | `{run,history}`；完整版本 |
| POST | `/api/runs/batch` | `{productIds:[最多5条],input:{workflow:'listing',...}}`；逐项结果 |
| GET | `/api/runs/:id/export` | JSON草稿包；`?format=md`返回Markdown |
| POST | `/api/tickets` | `{runId,reason}`；人工队列，不发送通知 |
| PATCH | `/api/tickets/:id` | `{expectedVersion,status,assignedTo,note}`；认领／解决／重开 |

生成接口支持可选 `Idempotency-Key`（8–100位字母数字、下划线、连字符）。相同键相同请求返回已完成结果；相同键不同内容409；正在处理409。进程崩溃不保证 exactly-once，需核对历史。

```json
{"workflow":"rfq","productId":"HF-BOX-01","market":"DE","mode":"demo","prompt":"请提供500件的报价回复","quantity":500,"unitPriceCents":320,"incoterm":"FOB","place":"Ningbo","leadDays":25,"validDays":14}
```

`workflow` = rfq/support/listing/compliance；`market` = US/DE；`mode` = demo/live。始终生成英文与德文。修订只允许变更数量、整数分单价、有效天数、生产天数、币种、贸易术语、地点、付款约定；产品／市场／方向切换需新建任务。`sourceRunId`用于关联原任务并继承商品快照，要求商品ID一致。

每个结果包含 input、product 快照、output 双语结构、quote 程序金额、knowledge 匹配条目、validation 风险、trace 模型与调用标识／耗时／用量。模型输出不能控制数据库查询、发送消息或执行代码。最近任务列表最多200条；指定ID和版本仍可访问。

错误处理：输入400、未授权401、不受信任来源403、资源404、冲突409、请求过大413、频率或并发429、上游异常502、未配置503、超时504。客户端可按错误提示修改或重试；服务器不泄露上游原始错误内容。
