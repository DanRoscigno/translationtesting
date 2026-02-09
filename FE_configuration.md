---
displayed_sidebar: docs
---

import FEConfigMethod from '../../_assets/commonMarkdown/FE_config_method.mdx'

import AdminSetFrontendNote from '../../_assets/commonMarkdown/FE_config_note.mdx'

import StaticFEConfigNote from '../../_assets/commonMarkdown/StaticFE_config_note.mdx'

import EditionSpecificFEItem from '../../_assets/commonMarkdown/Edition_Specific_FE_Item.mdx'

# FE 配置

<FEConfigMethod />

## 查看 FE 配置项

FE 启动后，您可以在 MySQL 客户端上执行 \`ADMIN SHOW FRONTEND CONFIG\` 命令来查看参数配置。如果您想查询某个特定参数的配置，请执行如下命令：

```SQL
ADMIN SHOW FRONTEND CONFIG [LIKE "pattern"];
```

返回字段的详细说明，请参见[ADMIN SHOW CONFIG](../../sql-reference/sql-statements/cluster-management/config_vars/ADMIN_SHOW_CONFIG.md).

:::note
您必须拥有管理员权限才能运行集群管理相关命令。
:::

## 配置 FE 参数

### 配置 FE 动态参数

[设置 FE 配置](../../sql-reference/sql-statements/cluster-management/config_vars/ADMIN_SET_CONFIG.md).

```SQL
ADMIN SET FRONTEND CONFIG ("key" = "value");
```

<AdminSetFrontendNote />

### 配置 FE 静态参数

<StaticFEConfigNote />

## 了解 FE 参数

### 日志

##### audit_log_delete_age

- 默认值：30d
- 类型：String
- 单位：-
- 是否可变：否
- 说明：审计日志文件的保留期限。默认值`30d`指定每个审计日志文件可以保留 30 天。StarRocks 会检查每个审计日志文件，并删除 30 天前生成的日志文件。
- 引入版本：-

##### audit_log_dir

- 默认值：StarRocksFE.STARROCKS\_HOME\_DIR + "/log
- 类型：String
- 单位：-
- 是否可变：否
- 说明：存储审计日志文件的目录。
- 引入版本：-

##### `audit_log_enable_compress`

- 默认值：false
- 类型：布尔
- 单位：无
- 是否可变：否
- 参数描述：当设置为 \`true\` 时，生成的 Log4j2 配置会在轮转的审计日志文件名（\`fe.audit.log.\*\`）后附加 \`.gz\` 后缀，以便 Log4j2 在日志轮转时生成压缩后的（\`.gz\` 格式）归档审计日志文件。该设置在 FE 启动期间由 \`Log4jConfig.initLogging\` 读取，并应用于审计日志的 \`RollingFile\` appender；它只影响轮转或归档的日志文件，不影响当前正在写入的审计日志文件。由于该值在启动时初始化，因此更改此设置需要重启 FE 才能生效。请与审计日志轮转相关设置（\`audit\_log\_dir\`、\`audit\_log\_roll\_interval\`、\`audit\_roll\_maxsize\`、\`audit\_log\_roll\_num\`）一起使用。
- 引入版本：3.2.12

##### audit_log_json_format

- 默认：false
- 类型：布尔
- 单位：无
- 是否可变：是
- 描述：当设置为 \`true\` 时，FE 审计事件将以结构化 JSON 格式（Jackson ObjectMapper 序列化一个由带注解的 AuditEvent 字段组成的 Map）输出，而不是默认的竖线分隔的 \`key=value\` 字符串格式。该设置会影响由 AuditLogBuilder 处理的所有内置审计日志接收器：连接审计、查询审计、大查询审计（当事件符合条件时，大查询阈值字段会添加到 JSON 中）以及慢查询审计输出。为大查询阈值和 \`features\` 字段添加的注解会得到特殊处理（这些字段会从常规审计条目中排除，并根据情况包含在大查询日志或特性日志中）。启用此项可使日志对于日志收集器或 SIEMs 变为机器可解析的格式；请注意，这会改变日志格式，可能需要更新任何期望使用旧版竖线分隔格式的现有解析器。
- 起始版本：3.2.7

##### audit_log_modules

- 默认值：slow\_query, query
- 类型：String\[]
- 单位：-
- 是否可变：否
- 描述：用于指定生成审计日志的模块。默认情况下，会为 ... 生成审计日志。`slow_query`模块和`query`模块。该`connection`从 v3.0 版本开始支持该模块。模块名称之间使用逗号（,）和空格分隔。
- 引入版本：-

##### audit_log_roll_interval

- 默认值：DAY
- 类型：String
- 单位：-
- 是否可变：否
- 描述：StarRocks 轮转审计日志的时间间隔。有效值：`DAY`和`HOUR`.
  - 如果该参数设置为“`DAY`，……中的后缀`yyyyMMdd`格式会添加到审计日志文件名中。
  - 如果该参数设置为`HOUR`，……中的一个后缀`yyyyMMddHH`\` format\` 会添加到审计日志文件的名称中。
- 引入版本：-

##### audit_log_roll_num

- 默认值：90
- 类型：Int
- 单位：-
- 是否可变：否
- 参数描述：每个保留期限内可保留的审计日志文件的最大数量，该保留期限由“`audit_log_roll_interval`参数。
- 引入版本：-

##### bdbje_log_level

- 默认值：INFO
- 类型：String
- 单位：-
- 是否可变：否
- 描述：控制 StarRocks 中 Berkeley DB Java Edition (BDB JE) 使用的日志级别。在 BDB 环境初始化期间，\`BDBEnvironment.initConfigs()\` 会将此值应用于 Java logger。`com.sleepycat.je`包以及 BDB JE 环境文件日志级别（\`EnvironmentConfig.FILE\_LOGGING\_LEVEL\`）。接受标准的 \`java.util.logging.Level\` 名称，例如 \`SEVERE\`、\`WARNING\`、\`INFO\`、\`CONFIG\`、\`FINE\`、\`FINER\`、\`FINEST\`、\`ALL\`、\`OFF\`。设置为 \`ALL\` 将启用所有日志消息。提高日志详细程度会增加日志量，并可能影响磁盘 I/O 和性能；该值在 BDB 环境初始化时被读取，因此仅在环境（重新）初始化后生效。
- 起始版本：v3.2.0

##### big_query_log_delete_age

- 默认值：7d
- 类型：String
- 单位：-
- 是否可变：否
- 描述：控制 FE 大查询日志文件（`fe.big_query.log.*`）会在自动删除前被保留。该值会作为 IfLastModified age 传递给 Log4j 的删除策略 — 任何轮转的大查询日志，如果其最后修改时间早于此值，都将被删除。支持的后缀包括`d`（天），`h`（小时），`m`（分钟），和`s`（秒）。示例：`7d`（7 天），`10h`（10 小时），`60m`（60 分钟），以及`120s`（120 秒）。该项与`big_query_log_roll_interval`和`big_query_log_roll_num`以确定保留或清除哪些文件。
- 起始版本：v3.2.0

##### big_query_log_dir

- 默认：`Config.STARROCKS_HOME_DIR + "/log"`
- 类型：String
- 单位：-
- 是否可变：否
- 描述：FE 写入大查询转储日志的目录（`fe.big_query.log.*`”）。Log4j 配置使用此路径为“`fe.big_query.log`及其轮转文件。轮转和保留由`big_query_log_roll_interval`（基于时间的后缀），`log_roll_size_mb`（大小触发），`big_query_log_roll_num`（最大文件数），和`big_query_log_delete_age`（基于存活时间的删除）。当查询超过用户定义的阈值（例如`big_query_log_cpu_second_threshold`，`big_query_log_scan_rows_threshold`，或`big_query_log_scan_bytes_threshold`。使用`big_query_log_modules`用于控制哪些模块将日志写入此文件。
- 起始版本：v3.2.0

##### big_query_log_modules

- 默认：`{"query"}`
- 类型：String\[]
- 单位：-
- 是否可变：否
- 描述：模块名称后缀列表，用于为每个模块开启大查询日志记录。典型值为逻辑组件名称。例如，默认值为`query`生成`big_query.query`.
- 起始版本：v3.2.0

##### big_query_log_roll_interval

- 默认：`"DAY"`
- 类型：String
- 单位：-
- 是否可变：否
- 描述：指定用于构建滚动文件名的日期部分的时间间隔，适用于`big_query`日志输出器。有效值（不区分大小写）为`DAY`（默认）和`HOUR`。`DAY`生成每日模式 (`"%d{yyyyMMdd}"`）和“`HOUR`生成按小时的模式（`"%d{yyyyMMddHH}"`)。该值与基于大小的滚动 (`big_query_roll_maxsize`）和基于索引的滚动（`big_query_log_roll_num`）以构成 \`RollingFile\` 的 \`filePattern\`。无效值会导致日志配置生成失败（\`IOException\`），并可能阻止日志初始化或重新配置。请与`big_query_log_dir`，`big_query_roll_maxsize`，`big_query_log_roll_num`，以及`big_query_log_delete_age`.
- 起始版本：v3.2.0

##### big_query_log_roll_num

- 默认值：10
- 类型：Int
- 单位：-
- 是否可变：否
- 参数说明：每个...要保留的轮转 FE 大查询日志文件的最大数量`big_query_log_roll_interval`。该值与 RollingFile appender 的 DefaultRolloverStrategy 绑定。`max`的属性`fe.big_query.log`；当日志滚动时（按时间或按`log_roll_size_mb`), StarRocks 最多保留`big_query_log_roll_num`索引文件（\`filePattern\` 使用时间后缀加索引）。早于此计数值的文件可能会被滚动删除，并且`big_query_log_delete_age`还可以根据文件的最后修改时间删除文件。
- 起始版本：v3.2.0

##### dump_log_delete_age

- 默认值：7d
- 类型：String
- 单位：-
- 是否可变：否
- 说明：dump 日志文件的保留期限。默认值`7d`指定每个 Dump 日志文件可以保留 7 天。系统会检查每个 Dump 日志文件，并删除 7 天前生成的日志文件。
- 引入版本：-

##### dump_log_dir

- 默认值：StarRocksFE.STARROCKS\_HOME\_DIR + "/log
- 类型：String
- 单位：-
- 是否可变：否
- 描述：存储 dump 日志文件的目录。
- 引入版本：-

##### 日志转储模块

- 默认值：query
- 类型：String\[]
- 单位：-
- 是否可变：否
- 参数说明：指定 StarRocks 为哪些模块生成转储日志。默认情况下，StarRocks 为查询模块生成转储日志。模块名称之间使用逗号（,）和空格分隔。
- 引入版本：-

##### dump_log_roll_interval

- 默认值：DAY
- 类型：String
- 单位：-
- 是否可变：否
- 描述：StarRocks 轮转 dump 日志条目的时间间隔。有效值：`DAY`和`HOUR`.
  - 如果该参数设置为“`DAY`，……中的后缀`yyyyMMdd`\` format\` 会被添加到 dump 日志文件的名称中。
  - 如果该参数设置为“`HOUR`，……中的后缀`yyyyMMddHH`\` format\` 会被添加到 dump 日志文件的名称中。
- 引入版本：-

##### dump_log_roll_num

- 默认值：10
- 类型：Int
- 单位：-
- 是否可变：否
- 参数描述：在由...指定的每个保留期限内可以保留的 dump 日志文件的最大数量`dump_log_roll_interval`参数。
- 引入版本：-

##### 编辑日志写入慢日志阈值（毫秒）

- 默认值：2000
- 类型：Int
- 单位：毫秒
- 是否可变：是
- 描述：JournalWriter 用来检测并记录慢速 edit-log 批量写入的阈值（单位：毫秒）。批量提交后，如果批处理耗时超过此值，JournalWriter 会发出一个 WARN 告警，其中包含批处理大小、耗时以及当前的 journal 队列大小（频率限制为大约每 2 秒一次）。此设置仅控制 Leader FE 上潜在 IO 或复制延迟的日志记录/告警，不会改变提交或回滚行为（请参见`edit_log_roll_num`和提交相关的设置）。无论此阈值如何，指标更新仍会进行。
- 起始版本：v3.2.3

##### enable_audit_sql

- 默认值：\`true\`
- 类型：布尔
- 单位：-
- 是否可变：否
- 说明：当此项设置为`true`，FE 审计子系统会将语句的 SQL 文本记录到 FE 审计日志（`fe.audit.log`）由 ConnectProcessor 处理。存储的语句遵循其他控制：加密的语句会被脱敏处理（`AuditEncryptionChecker``enable_sql_desensitize_in_log`已设置，并且摘要记录由...控制`enable_sql_digest`。当设置为`false`，ConnectProcessor 会在审计事件中将语句文本替换为“?”——其他审计字段（用户、主机、持续时间、状态、通过“`qe_slow_log_ms`，以及指标）仍然会被记录。启用 SQL 审计可以提高取证和故障排查的可见性，但可能会暴露敏感的 SQL 内容并增加日志量和 I/O；禁用 SQL 审计可以提高隐私性，但代价是在审计日志中会失去完整的 SQL 语句可见性。
- 引入版本：-

##### enable_profile_log

- 默认值：\`true\`
- 类型：布尔
- 单位：-
- 是否可变：否
- 参数描述：是否开启 Profile 日志功能。开启该功能后，FE 会写入每个查询的 Profile 日志（序列化后的`queryDetail`由...生成的 JSON`ProfileManager`）到 profile 日志接收端。仅当“`enable_collect_query_detail_info`也被启用；当`enable_profile_log_compress`启用后，JSON 文件在记录日志前可能会被 gzipped 压缩。Profile 日志文件由`profile_log_dir`，`profile_log_roll_num`，`profile_log_roll_interval`并根据 ... 进行轮转和删除`profile_log_delete_age`（支持...等格式，例如`7d`，`10h`，`60m`，`120s`）。禁用此功能会停止写入 profile 日志（减少磁盘 I/O、压缩 CPU 和存储使用量）。
- 起始版本：v3.2.5

##### 启用慢查询日志

- 默认值：\`true\`
- 类型：布尔
- 单位：无
- 是否可变：是
- 描述：启用后，FE 内置的审计插件 (AuditLogBuilder) 会将执行时间（“Time” 字段）超过 \`qe\_slow\_log\_ms\` 所配置阈值的查询事件写入慢查询审计日志 (AuditLog.getSlowAudit) 中。如果禁用，这些慢查询日志条目将被抑制（常规的查询和连接审计日志不受影响）。慢查询审计日志条目的格式遵循全局 \`audit\_log\_json\_format\` 的设置（JSON 或普通字符串）。使用此参数可以独立于常规审计日志来控制慢查询审计日志的生成量；当 \`qe\_slow\_log\_ms\` 配置得较低或工作负载中包含大量长时间运行的查询时，关闭此参数可以减少日志 I/O。
- 起始版本：3.2.11

##### 在日志中启用 SQL 脱敏

- 默认：false
- 类型：布尔
- 单位：-
- 是否可变：否
- 说明：当此项设置为`true`，系统会在将敏感 SQL 内容写入日志和查询详情记录之前，对其进行替换或隐藏。遵循此配置的代码路径包括 \`ConnectProcessor.formatStmt\`（审计日志）、\`StmtExecutor.addRunningQueryDetail\`（查询详情）和 \`SimpleExecutor.formatSQL\`（内部执行器日志）。启用该功能后，无效的 SQL 可能会被替换为固定的脱敏消息，凭证（用户/密码）会被隐藏，并且 SQL 格式化程序需要生成一个经过清理的表示形式（它还可以启用摘要式输出）。这减少了敏感字面量和凭证在审计/内部日志中的泄露，但也意味着日志和查询详情不再包含原始的完整 SQL 文本（这可能会影响重放或调试）。
- 引入版本：-

##### internal_log_delete_age

- 默认值：7d
- 类型：String
- 单位：-
- 是否可变：否
- 描述：指定 FE 内部日志文件的保留期限（写入到`internal_log_dir`). 该值为时长字符串。支持的后缀：`d`（天），`h`（小时），`m`（分钟），`s`（秒）。示例：`7d`（7 天），`10h`（10 小时），`60m`（60 分钟），`120s`（120 秒）。此项会代入 log4j 配置中，作为`<IfLastModified age="..."/>`滚动文件删除策略所使用的判断条件。在日志滚动期间，最后修改时间早于该时间段的文件将被删除。增加该值可以更快地释放磁盘空间，减小该值可以更长时间地保留内部物化视图或统计信息日志。
- 引入版本：v3.2.4

##### internal_log_dir

- 默认：`Config.STARROCKS_HOME_DIR + "/log"`
- 类型：String
- 单位：-
- 是否可变：否
- 描述：FE 日志子系统用于存储内部日志的目录（`fe.internal.log`”）。此配置会代入 Log4j 配置，并决定 InternalFile appender 将内部日志、物化视图日志、统计信息日志写入的位置，以及“"下各模块日志记录器的写入位置。`internal.<module>`放置文件。请确保该目录存在、可写，并具有足够的磁盘空间。该目录中文件的日志轮转和保留由`log_roll_size_mb`，`internal_log_roll_num`，`internal_log_delete_age`，以及`internal_log_roll_interval`。如果`sys_log_to_console`启用后，内部日志可能会写入控制台，而不是此目录。
- 引入版本：v3.2.4
