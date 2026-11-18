# Adtomatic 免费 Zoom Landing Page + CRM + Analytics

全部是我们自己的：网站、预约、CRM（`/crm`）、Analytics（CRM 里的第二个 tab）。
两种跑法，**同一份代码**：

| | 自己的服务器（现在用这个） | Vercel |
|---|---|---|
| 启动 | `node server.js` | 连 GitHub 自动部署 |
| 资料存在哪 | 服务器上的 `data/` 文件夹 | Vercel Blob（私密） |
| 写入上限 | 没有 | Hobby 每月 2,000 次 |
| 设定 | `.env` 文件 | Environment Variables |

## 在自己的服务器跑（没有 domain 也可以）

需要：一台 Linux 服务器（VPS），装 **Node.js 20 或以上**。不用装 database，不用 `npm install`。

```bash
# 1. 拿代码
git clone https://github.com/skyiededucation-png/Adtomatic-Sales-Page.git adtomatic
cd adtomatic

# 2. 设定
cp .env.example .env
nano .env            # 至少改 CRM_PASSWORD

# 3. 试跑
node server.js       # 看到 "Adtomatic running on http://SERVER-IP:3000"
```

打开 `http://服务器IP:3000`（网站）和 `http://服务器IP:3000/crm`（CRM）。打不开的话，在服务器防火墙开 3000 port（例如 `sudo ufw allow 3000`）。

**一直开着（关掉 SSH 也不停）：**

```bash
sudo npm install -g pm2
pm2 start server.js --name adtomatic
pm2 save && pm2 startup      # 服务器重开机也会自动跑
pm2 logs adtomatic           # 看 log
```

**更新代码：** `git pull && pm2 restart adtomatic`

**备份：** 所有 lead 和 analytics 都在 `data/` 文件夹，定期复制出来（例如 `tar czf backup-$(date +%F).tgz data`）。`data/` 和 `.env` 不会上传到 GitHub。

**之后买了 domain：**
1. Domain 的 DNS 加一笔 A record 指向服务器 IP
2. 装 Caddy（自动 HTTPS）：`/etc/caddy/Caddyfile` 写
   ```
   你的domain.com {
     reverse_proxy localhost:3000
   }
   ```
   然后 `sudo systemctl reload caddy`
3. 有 HTTPS 之后才可以：接 HubSpot 客户的网站（HTTPS 页面不能送资料到 HTTP 网址）、在 Meta 做 domain verification

---

# Adtomatic 免费 Zoom Landing Page — 上线 SOP

目标：广告 → Landing Page → 预约 Zoom → Meta 看到 **Schedule** 事件 → Ads Manager 的 Cost per Result = **Cost per Appointment**。

```
index.html      Landing Page（VSL + 底部晃动按钮 → 预约页）
book.html       填资料（行业选「其他」可自己写）+ 选日期 / 时间（或自己写方便的时间）
thank-you.html  预约成功 + WhatsApp 确认按钮 + Thank-you VSL + 加进 Google Calendar + 准备清单
crm.html        CRM：所有预约名单、状态、备注、WhatsApp 客户、导出 CSV（要密码）
api/lead.js     预约提交 → 存进 CRM + Meta Conversions API（Schedule）
api/_store.js   CRM 储存层（现在用 Vercel Blob，将来换自己的数据库只改这里）
api/leads.js    CRM 读取 / 更新（要密码）
js/config.js    Pixel ID / WhatsApp 号码 / 可选时段 / 开放日（只改这里）
```

## 流程

广告 → Landing Page（看 VSL）→ 按底部按钮 → 预约页填资料 + 选时间 → **自动存进 CRM** → Thank-you 页 → 客户按绿色按钮 WhatsApp 确认 / 加 Google Calendar / 看 Thank-you VSL

## 追踪逻辑

| 时机 | 浏览器 Pixel | 服务器 CAPI |
|---|---|---|
| 打开任何一页 | PageView | — |
| 播放 VSL / 看到 50% / 看完 | VSLView（custom） | — |
| 点底部按钮 | InitiateCheckout | — |
| 点 WhatsApp 拿 Case Study | Contact | — |
| 打开预约页 | ViewContent | — |
| **按「确认预约」（同时存进 CRM）** | **Schedule**（event_id = `bk_…`） | **Schedule**（同一个 event_id，带 hash 过的电话 + IP + UA） |
| Thank-you 页按 WhatsApp 确认 | Contact | — |

两边 event_id 一样 → Meta 只算 1 次。

每个 Schedule 都会在 CRM 里有一笔记录，可以直接拿 CRM 的数量对 Ads Manager。

## Step 1 · 改设定（js/config.js）

- `pixelId`：你的 Pixel ID
- `bookingWhatsApp`：Thank-you 页 WhatsApp 确认发去哪个号码（现在是 60182626442）
- `timeSlots`：可选时段（现在 10AM – 8PM 开始，每小时一场，9PM 前结束）
- `closedWeekdays`：不开放的日子（现在 `[0, 6]` = 星期六、日不开放）
- 没有接 Google Calendar：同一个时段可能有两个人选到，由 setter 打电话时调整

## Step 1.5 · 开 CRM 储存（一次就好，全部在 Vercel 里面）

CRM 是我们自己的页面（`/crm`），资料存在 **Vercel 自己的 Blob 储存**，在同一个 Vercel Project 里面，不用开其他平台的账号。

1. Vercel → 你的 Project → **Storage** → **Create** → 选 **Blob** → Access 选 **Private** → Connect to Project
2. Settings → Environment Variables 加 **`CRM_PASSWORD`**，自己定一串长密码
3. **Redeploy**
4. 检查：打开 `https://你的网址/api/lead`，看到 `"crm":true` 就是连好了
5. 打开 `https://你的网址/crm`，输入密码

每个 lead 是一个私密 JSON 文件（`crm/leads/<编号>.json`），只有带密码的 CRM 页面读得到。
CRM 功能：状态（新 Lead / 已联络 / 已确认 / 已出席 / No-show / 成交 / 不合适）、备注、一键 WhatsApp 客户、搜索、导出 CSV。
将来换成我们自己的 CRM / 数据库，只要改 `api/_store.js` 这一个文件。
CRM 密码只给需要跟进的同事。客户资料是个人资料，不要截图外传。

## Step 2 · 部署到 Vercel（你做，约 5 分钟）

1. 把这个文件夹上传到一个 GitHub repo（或用 `npx vercel` 直接部署）
2. Vercel → Add New Project → 选这个 repo → Framework Preset 选 **Other** → Deploy
3. 记下网址，例如 `https://adtomatic-zoom.vercel.app`（之后可以接你自己的域名）

> ⚠️ Vercel **Hobby（免费）只限非商业用途**。测试可以，正式开广告前升级 Pro，或改放允许商用的托管。

## Step 3 · Meta 设定（你做）

1. Events Manager → 选你的 Pixel → 复制 **Pixel ID** → 填进 `js/config.js` 的 `pixelId`
2. Settings → Conversions API → **Generate access token**（不要发给任何人 / 不要贴在聊天里）
3. Vercel → Project → Settings → **Environment Variables**，加：

| Name | Value |
|---|---|
| `META_PIXEL_ID` | 你的 Pixel ID |
| `META_CAPI_TOKEN` | 刚生成的 token |
| `META_TEST_EVENT_CODE` | 测试时才填（Events Manager → Test events 里的代码），测完删掉 |

加完要 **Redeploy** 一次才生效。

## Step 5 · 测试（上线前一定要做）

1. Vercel 填好 `META_TEST_EVENT_CODE` → Redeploy
2. Events Manager → **Test events** 打开
3. 用手机打开网站 → 点按钮 → 填资料、选时间 → 按「确认预约」→ 在 WhatsApp 按发送
4. Test events 里应该看到：PageView、InitiateCheckout、ViewContent、**Schedule（Browser）** + **Schedule（Server）**，而且 Schedule 显示 *Deduplicated*
5. 检查 018-262 6442 有没有收到预约讯息；也用 Facebook / Instagram 广告预览点进来测一次（in-app browser）
6. 删掉 `META_TEST_EVENT_CODE` → Redeploy

## Step 6 · 开广告

- Campaign objective：**Sales**（或 Leads）→ Conversion location：**Website**
- Conversion event：**Schedule**
- Ads Manager 加栏位：Results（Schedule）、Cost per Result = **Cost per Appointment**
- 广告链接用 `https://你的网址/?utm_source=meta&utm_campaign=…`（fbclid 会一路带到预约页，提高 Meta 匹配率）

## 每个预约之后（手动）

- 名额数字在 3 个地方：`index.html`（零风险段、底部按钮小字）和 `book.html`，接满就更新，保持真实
- 时段被订走：在 `js/config.js` 调整 `timeSlots` / `closedWeekdays`
- Show / No-show / 成交：之后可以再加 Attended、Purchase 事件回传给 Meta，算真正的 Cost per Show / CAC


## Analytics（CRM 里的第二个 tab）

自己的追踪，不用 Google Analytics。每一页加载 `js/t.js`，资料存在同一个 Vercel Blob（私密），在 `/crm` → **Analytics** 看。

看得到：访问、访客、转化率、平均停留、跳出率、**转化漏斗**、**每个 Ad / Ad set / Campaign 的转化率**、来源、设备、每日趋势、滚动深度、VSL 看到几 %、**每一段内容有多少人看到 + 停多久**、**每个按钮 / 链接被谁点**、**表单每一格在哪里放弃**、自定义事件。上面可以按来源 / Campaign / Ad set / Ad / 设备筛选。

不会记录客户打了什么字，只记录点了哪一格。

### 开启

- **自己的服务器：** `.env` 里 `ANALYTICS_ENABLED=1`（`.env.example` 已经是开着的），`ANALYTICS_SITES=adtomatic,client-a`，然后 `pm2 restart adtomatic`
- **Vercel：** 默认已经开着，连好 Blob 就会开始记录。每个页面浏览大约写 1 次。⚠️ Hobby 每月 2,000 次写入，用完会锁住储存 30 天（CRM 也会停），Vercel 会先发 email 提醒，看到就升级 Pro
- 要关掉：`ANALYTICS_ENABLED` = `0`

### Meta 广告网址参数（知道 lead 是哪一个 Ad 来的）

在每个广告（或在 Ad set 层用 bulk edit）→ **Tracking → URL parameters** 贴上：

```
utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}
```

结果：
- **CRM 每个 lead** 会显示 Campaign / Ad set / Ad 名字和 ID，导出 CSV 也有
- **Analytics** 的「广告表现」表可以比较每个 Ad 的 Sessions → 看 VSL → 开始填表 → 提交预约 → 转化率

Meta CAPI 本身不会回传 Ad ID 给我们；Ad ID 是靠这串网址参数带进来的，客户点广告进来后会记住 30 天。

### 用在 HubSpot 客户的页面

HubSpot → Settings → Content → Pages → **Site header HTML**（或单一页面的 Advanced → Head HTML），贴：

```html
<script async src="https://你的domain/js/t.js" data-site="client-a"></script>
```

⚠️ HubSpot 页面是 HTTPS，所以我们这边也要有 domain + HTTPS 才收得到（见上面「之后买了 domain」）。

- `data-site` 每个客户一个名字（小写英文、数字、-），在 CRM 的 Analytics 右上角切换
- HubSpot 表单提交会自动记成 `hs_form_submit`，漏斗 = 访问 → 有互动 → 开始填表 → 提交表单
- 想给按钮 / 段落取名字：按钮加 `data-track="名字"`，段落加 `data-section="名字"`
- 自己的代码要记录重要动作：`window.adtTrack('purchase', { value: 1000 })`
- 客户网站的访客资料也是个人资料，记得在客户的 Privacy Policy 提到网站分析
