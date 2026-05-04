# Glassdoor Analyst Job Scraper

这个文档记录当前项目里的每日职位抓取流程。脚本文件是：

```powershell
daily-glassdoor-analyst-jobs.js
```

运行后会自动完成 Glassdoor 职位抓取、筛选、简历匹配评分、生成 Markdown 结果，并通过 Gmail 发送表格邮件。

## 运行方式

在 Cursor 终端或 PowerShell 中进入项目目录：

```powershell
cd C:\Users\Windows\WeChatProjects\stayonCourt
```

然后运行：

```powershell
node daily-glassdoor-analyst-jobs.js
```

## 运行前准备

1. 确认已经安装 Node.js。
2. 确认已经安装并可运行 `playwright-cli`。
3. 确认 `playwright-cli` 浏览器会话里已经登录 Glassdoor。
4. 配置 Gmail API 凭据。邮件发送现在不再依赖 Gmail 网页登录。

检查 `playwright-cli`：

```powershell
playwright-cli --version
```

当前脚本已兼容本机使用的 `playwright-cli 0.1.9`。

## 当前筛选规则

- 关键词：`analyst`
- Date posted：`Last 3 days`
- Seniority level：`All seniority levels`
- 城市：
  - `Toronto`
  - `Markham`
  - `Mississauga`
  - `Ottawa`
  - `North York`
  - `Vaughan`
  - `Etobicoke`
- 包含结果：
  - Glassdoor 主搜索结果
  - Glassdoor `Similar jobs`
- 主搜索结果优先级最高：脚本会先尽量滚动/加载并检查 main 搜索结果。
- `Similar jobs` 只检查 main 职位详情页中直接出现的一层，不会从 similar job 继续递归扩散。
- 标题排除词：
  - `senior`
  - `sr.`
  - `student`
  - `intern`
  - `internship`
  - `co-op`
  - `coop`
  - `trainee`
- 标题排除只看职位标题，不看完整 job description。
- `Similar jobs` 额外要求地点必须在目标城市中，否则剔除。

## 经验年份规则

只排除明确要求严格 `3+` 或更高经验的职位，例如：

- `3+ years`
- `3 or more years`
- `minimum 3 years`
- `at least 3 years`
- `3-5 years`
- `4+ years`

保留下限低于 3 年的范围，例如：

- `0-3 years`
- `1-3 years`
- `2-4 years`
- `2-5 years`

如果 `3 years` 出现在 preferred、asset、nice to have 等非硬性要求语境中，也尽量保留。

## 匹配评分依据

职位会根据简历关键词和岗位内容打分，主要匹配方向包括：

- Business Analyst
- Business analysis
- Agile
- SDLC
- Requirements elicitation
- Stakeholder collaboration
- Jira
- Excel
- SQL
- Power BI
- UAT
- Data analysis
- Dashboard / reporting
- Process improvement
- Six Sigma
- Compliance
- AI / machine learning analytics

分数越高，说明和简历背景越接近。

## 输出文件

脚本会更新：

```powershell
system-analyst-jobs.md
```

该文件包含：

- 本次运行时间
- 筛选规则
- 匹配职位数量
- 被排除职位统计
- 城市搜索摘要
- 排序后的职位表格
- 每个职位的 `Apply Link`
- 每个职位的 `Job Link`
- 匹配点
- 经验要求依据
- 提取到的职位内容摘要

## 历史推送去重

脚本会维护一个历史推送文件：

```powershell
system-analyst-jobs-history.json
```

这个文件的用途不是保留旧职位到结果里，而是避免重复推送邮件：

- `system-analyst-jobs.md` 仍然保存本次运行检索到的完整匹配结果。
- 邮件只发送历史文件中没有推送过的新职位。
- Gmail API 发送成功后，脚本才会把这些新职位写入历史文件。
- 如果邮件发送失败，不会把职位标记为已推送。

历史文件已加入 `.gitignore`，避免误提交。

## Gmail API 邮件发送

脚本会向以下邮箱发送结果：

```text
taoxiaoci411@gmail.com
```

邮件主题：

```text
Glassdoor analyst matches - Full table with apply links
```

邮件正文会生成 HTML 表格，包含本次运行中新匹配、且历史上没有推送过的职位。表格字段包括：

- Rank
- Score
- Title
- Company
- Location
- Found In
- Matching Points
- Experience Evidence
- Apply Link
- Job Link

### 首次配置 Gmail API

邮件发送使用 Gmail API，不再自动操作 Gmail 网页。首次配置步骤：

1. 打开 Google Cloud Console。
2. 创建或选择一个项目。
3. 启用 `Gmail API`。
4. 配置 OAuth consent screen。
5. 创建 OAuth Client，类型选择 `Desktop app`。
6. 下载 OAuth JSON 文件。
7. 将文件保存到项目根目录，并命名为：

```powershell
.gmail-credentials.json
```

第一次运行脚本时，会自动打开 Google 授权页面。登录并授权后，脚本会在本地生成：

```powershell
.gmail-token.json
```

之后脚本会自动使用 refresh token 发送邮件，不需要每天手动登录 Gmail。

这两个文件包含敏感信息，已经加入 `.gitignore`：

```powershell
.gmail-credentials.json
.gmail-token.json
```

## 重要技术说明

本机 `playwright-cli` 版本是 `0.1.9`。这个版本有几个限制：

- 不支持稳定使用 `--filename` 传入长脚本。
- 不支持可靠使用 `--raw` 输出。
- 直接把长 JavaScript 代码作为 `run-code` 参数传入时，PowerShell/Windows 会把参数拆开。
- `run-code` 里的普通双引号可能被解析掉。

为了解决这些问题，`daily-glassdoor-analyst-jobs.js` 使用了兼容传输方案：

1. Node.js 将长 Playwright 脚本写入临时文件。
2. 再将脚本内容转成 base64。
3. 将 base64 分成小块，通过短 `run-code` 命令写入浏览器 `localStorage`。
4. 最后用一个短 `run-code` 从 `localStorage` 读取、解码并 `eval` 执行。

这样可以避免 Windows 命令行长度、引号和参数拆分问题。

## 常见错误

### `spawnSync playwright-cli ENOENT`

说明 Node.js 找不到 `playwright-cli`。

解决：

```powershell
npm install -g @playwright/cli@latest
```

然后重新打开终端或重新运行：

```powershell
playwright-cli --version
```

### `Unknown command: "--raw"`

说明当前 `playwright-cli` 不接受 `--raw` 放在命令前面。当前脚本已避免依赖 `--raw`。

### `Unknown command: "run-code"`

通常是命令拼接方式导致参数被错误解析。当前脚本已改成分块传输，不再直接传长命令。

### `too many arguments: expected 1`

说明长 JS 被 PowerShell 拆成多个参数。当前脚本已通过 base64 分块传输解决。

### `ReferenceError: glassdoorFlow... is not defined`

说明字符串引号在 `playwright-cli run-code` 中被吃掉。当前脚本使用 `String.fromCharCode(...)` 构造传输字符串，避免这个问题。

## 每日使用建议

每天运行前，先确认：

1. Glassdoor 登录状态还在。
2. `.gmail-credentials.json` 和 `.gmail-token.json` 存在。
3. 网络正常。
4. 当前目录是项目根目录。

然后运行：

```powershell
node daily-glassdoor-analyst-jobs.js
```

运行完成后检查：

```powershell
system-analyst-jobs.md
```

并查看 Gmail 是否收到新的表格邮件。
