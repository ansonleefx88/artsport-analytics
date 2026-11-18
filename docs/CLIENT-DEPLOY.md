# Adtomatic Lead · CRM · Analytics 系统：客户 Landing Page 部署手册

> 给：Vincent（部署负责人）
> 代码：GitHub `skyiededucation-png/Adtomatic-Sales-Page`
> 版本：2026-11-18

这份手册说明这套系统怎么运作，以及怎么把它装到客户的 landing page 上：
客户留资料 / 预约 → **自动存进我们自己的 CRM** → 记录他是**从哪一个广告户口、Campaign、Ad set、Ad 来的** → 同时把转化回传给 **Meta（Pixel + Conversions API）** → 网站上的所有行为进 **Analytics**，可以导出原始数据做分析。

---

## 1. 整个流程

```
客户点 Meta 广告（网址带着广告参数）
        │
        ▼
Landing Page（加载 js/t.js）
  · 记下：广告户口 / Campaign / Ad set / Ad 的名字和 ID、placement、fbclid（保存 30 天）
  · 开始记录行为：页面、点击、滚动、看到哪一段、视频进度、表单栏位（不记录打的内容）
        │
        ▼
客户提交表单 / 预约（conversion）
  ├─ 浏览器：Meta Pixel 发 Lead / Schedule 事件（event_id = bk_xxxx）
  └─ POST /api/lead
        ├─ 存进 CRM：名字、电话、Email、公司、其他栏位 + 广告来源 + 哪个网站
        └─ 服务器：Meta Conversions API 发同一个事件（同一个 event_id → Meta 只算一次）
        │
        ▼
CRM（/crm，要密码）
  · 预约名单：状态、备注、一键 WhatsApp、导出 CSV
  · Analytics：漏斗、每个 Ad 的转化率、点击、段落、表单放弃点、导出 raw CSV
```

**Meta CAPI 不会告诉我们 lead 是哪一个 Ad 来的。** 广告来源是靠第 4 节的「广告网址参数」带进来的，没有贴的话，CRM 只会看到「直接打开」。

---

## 2. 选择部署方式

| | **方式 A：客户用我们的模板** | **方式 B：客户已经有自己的页面（HubSpot / WordPress / 其他）** |
|---|---|---|
| 适合 | 新客户、我们帮他做整个 landing page | 客户页面已经在 HubSpot 等平台上 |
| 做法 | 复制 repo → 改内容 → 部署一个新的 Vercel project | 在客户页面的 header 贴一行 script |
| CRM 在哪 | 客户自己的 `/crm`（资料分开） | 我们的 `/crm`，用「网站」筛选看这个客户 |
| 需要 | Vercel 账号 + GitHub | 我们的系统要有 **domain + HTTPS** |

**客户资料不要混在一起。** 每个大客户最好用方式 A，各自一个 Vercel project、各自一个 CRM 密码。方式 B 的 lead 会进我们自己的 CRM，用 `site` 区分。

---

## 3. 方式 A：客户用我们的模板（独立部署）

### 3.1 复制代码
1. GitHub → `Adtomatic-Sales-Page` → **Use this template** 或 Fork → 改名，例如 `client-a-landing`
2. 修改内容：
   - `index.html`：Landing Page 文案、图片、VSL
   - `book.html`：表单问题、时段
   - `thank-you.html`：感谢页、WhatsApp 号码
   - `js/config.js`：`pixelId`、`bookingWhatsApp`、`timeSlots`、`closedWeekdays`
   - 每个 `<script ... src="js/t.js" data-site="adtomatic">`：把 `adtomatic` 改成客户代号，例如 `client-a`（小写英文、数字、`-`）
   - `api/_an.js` 里的 `SITE_CFG`：客户用同样的预约流程的话，复制 `adtomatic` 那一组，key 改成 `client-a`；不是的话就用默认漏斗

### 3.2 部署到 Vercel
1. Vercel → **Add New → Project** → Import 这个 repo → Framework Preset 选 **Other** → Deploy
2. **Storage → Create → Blob → Access: Private → Connect to Project**（这是 CRM + Analytics 的储存）
3. **Settings → Environment Variables**：

| Key | Value | 必须？ |
|---|---|---|
| `CRM_PASSWORD` | 长密码，只给负责跟进的人 | ✅ |
| `ANALYTICS_SITES` | `client-a` | 建议 |
| `META_PIXEL_ID` | 客户的 Pixel ID | 开广告前 |
| `META_CAPI_TOKEN` | 客户 Pixel 的 Conversions API token（**不要发到聊天群**） | 开广告前 |
| `META_TEST_EVENT_CODE` | 测试时才填，测完删掉 | 测试用 |
| `ANALYTICS_ENABLED` | 不填 = 开；`0` = 关 | 可选 |

4. **Deployments → Redeploy**
5. 打开 `https://网址/api/lead`，要看到 `"crm":true`、`"storage":"blob"`、`"CRM_PASSWORD":true`

### 3.3 不用 Vercel，放客户 / 我们自己的服务器
需要 Node.js 20+，不用 database：
```bash
git clone <repo> client-a && cd client-a
cp .env.example .env && nano .env      # 填 CRM_PASSWORD、META_*、ANALYTICS_SITES
node server.js                         # http://服务器IP:3000
```
资料会存在 `data/` 文件夹，**一定要定期备份**。常驻运行用 `pm2`，HTTPS 用 Caddy，详细步骤见 `README.md`。

---

## 4. 广告网址参数（知道 lead 是哪个广告户口 / Ad 来的）

Meta Ads Manager → 每个 Ad（或在 Ad set 层用 bulk edit）→ **Destination → URL parameters**，贴：

```
utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&ad_account=act_XXXXXXXXX&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}
```

- `act_XXXXXXXXX` 换成这个**广告户口的 ID**（Ads Manager 左上角户口名字下面那串数字）。Meta 没有广告户口的动态参数，所以每个户口要手动填一次
- `{{...}}` 不用改，Meta 投放时会自动换成真的名字和 ID
- 新增 Ad 或复制 Ad 时，检查参数还在
- Ad 名字建议有规则，例如 `VSL-HookA-189行业`，方便在 Analytics 比较

**检查：** 在 Ads Manager 按「Preview」→ 打开链接 → 网址后面要看得到这些参数（变成真的值）。

结果：
- CRM 每个 lead 显示：来源 · placement · **Ad account** / **Campaign** / **Ad set** / **Ad**（名字 + ID）
- CRM 导出 CSV 有：Campaign、Campaign ID、Ad set、Ad set ID、Ad、Ad ID、Placement、Ad account
- Analytics 的「广告表现（按 Ad）」：每个 Ad 的 Sessions → 看 VSL → 开始填表 → 转化 → 转化率

来源会记住 **30 天**：客户今天点广告，三天后自己回来填表，一样算这个 Ad。

---

## 5. 方式 B：客户现有页面（HubSpot / WordPress / 其他）

> ⚠️ 客户页面是 HTTPS，所以我们的系统也要有 **domain + HTTPS** 才收得到。下面的 `https://你的domain` 换成我们系统的网址。

### 5.1 贴追踪代码（Analytics + 广告来源）
放在每一页的 `<head>`：
- **HubSpot**：Settings → Website（或 Content）→ Pages → Templates → **Site header HTML**（全站），或单一页面 → Settings → Advanced → **Head HTML**
- **WordPress**：WPCode / Insert Headers and Footers 插件 → Header

```html
<script async src="https://你的domain/js/t.js" data-site="client-a" data-hubspot-leads="1"></script>
```

| 属性 | 意思 |
|---|---|
| `data-site` | 客户代号，要跟 `ANALYTICS_SITES` 里的一样 |
| `data-hubspot-leads="1"` | HubSpot 表单提交后，**自动**把资料存进我们的 CRM（不是 HubSpot 就删掉这个） |
| `data-lead-event` | 回传给 Meta 的事件名称，默认 `Lead`；预约类可以用 `Schedule` |

然后在我们系统的 `ANALYTICS_SITES` 加上 `client-a`，例如 `adtomatic,client-a`，再 Redeploy / 重启。

### 5.2 Conversion → CRM

**HubSpot 表单：** 有 `data-hubspot-leads="1"` 就自动处理。对应规则：
- `firstname` + `lastname` → 名字
- `mobilephone` 或 `phone` → 电话
- `email` → Email
- `company` → 公司
- `industry` → 行业
- `message` → 挑战 / 备注
- 其他栏位 → 「其他栏位」（CRM 卡片和 CSV 都看得到）

一定要至少有 **名字或 Email**，加上 **电话或 Email** 其中一个，不然不会存。

**其他表单（自己写的、WordPress 等）：** 表单提交成功后加一行：

```html
<script>
  // 表单提交成功后呼叫
  if (window.adtLead) window.adtLead({
    name: '客户名字',
    phone: '0123456789',
    email: 'a@b.com',            // 可选
    company: '公司名',            // 可选
    industry: '装修',             // 可选
    challenge: '客户写的问题',     // 可选
    extra: { budget: 'RM50k' },  // 可选：任何其他栏位
    event_name: 'Lead'           // 可选：Lead / Schedule / CompleteRegistration / Contact / SubmitApplication
  });
</script>
```

`adtLead` 会自动做 4 件事：
1. 带上广告来源
2. 浏览器 Pixel 发事件（页面上有装 Meta Pixel 的话）
3. 服务器 CAPI 发同一个事件
4. 存进 CRM

### 5.3 让报表看得懂（可选，但建议）
- 重要按钮加名字：`<a href="..." data-track="Hero CTA · 免费报价">`
- 每一段加名字：`<section data-section="痛点">`
- 其他重要动作：`window.adtTrack('whatsapp_click')`、`window.adtTrack('purchase', { value: 1500 })`

没加的话，系统会自动用按钮文字和段落标题当名字。

### 5.4 Meta Pixel 去重提醒
客户页面原本就有 Meta Pixel，而且 HubSpot 自己也会发 Lead 事件的话，会**重复计算**。二选一：
- 关掉客户原本的 Lead 事件，只用我们的（建议）
- 或者在 HTML 拿掉 `data-hubspot-leads="1"`，只用来记录 Analytics

---

## 6. 资料存在哪里、长什么样

| 储存 | 位置 |
|---|---|
| Vercel | 这个 project 的 **Private Blob**，只有带密码的 `/crm` 读得到 |
| 自己的服务器 | `data/` 文件夹（`DATA_DIR` 可以改） |

```
crm/leads/<lead编号>.json                       ← 一个 lead 一个文件
an/<site>/raw/<日期>/<小时>/<时间>-<session>.json  ← Analytics 原始数据
an/<site>/roll/<日期>/day.json                  ← 每日汇总（报表加速用）
```

**Lead 的格式（存进 CRM 的内容）：**

```json
{
  "id": "261118-a1b2c3",
  "created_at": "2026-11-18T06:22:50.821Z",
  "site": "client-a",
  "page": "https://client.com/promo",
  "name": "Jason Tan",
  "phone": "012-345 6789",
  "email": "jason@abc.com",
  "company": "ABC Reno",
  "industry": "装修 / Renovation",
  "challenge": "每个 lead RM25，但很少人约见面",
  "extra": { "budget": "RM50k" },
  "date_label": "周五 11/20", "time": "2:00 PM", "custom_time": "",
  "ad": {
    "ad_account": "act_123456789",
    "source": "meta", "medium": "paid",
    "campaign": "Zoom Nov", "campaign_id": "120210001",
    "adset": "Broad 25-45", "adset_id": "120210011",
    "ad": "VSL Hook A", "ad_id": "120210101",
    "placement": "Facebook_Mobile_Feed", "landing": "/", "fbclid": 1
  },
  "vid": "访客编号", "sid": "session编号",
  "event_id": "bk_xxxxxxxx",
  "status": "new",
  "notes": ""
}
```

`vid` / `sid` 可以把 lead 和他在 Analytics 里的行为连起来：Sessions CSV 的 `session_id` = lead 的 `sid`。

**CRM 状态：** 新 Lead → 已联络 → 已确认 → 已出席 / No-show → 成交 / 不合适

---

## 7. Analytics 记录了什么

| 事件 | 什么时候 | 记录内容 |
|---|---|---|
| `page_view` | 打开页面 | 页面、来源、设备、屏幕宽度、国家 |
| `click` | 点按钮 / 链接 / 图片 | 按钮文字或 `data-track`、在哪一段、去哪里、页面位置 % |
| `scroll` | 滑到 25 / 50 / 75 / 90 / 100% | 深度 |
| `section_view` | 某一段出现在屏幕上 | 段落名字 |
| `leave` | 离开页面 | 真正有在看的秒数、每一段停了几秒 |
| `video` | 播放、25 / 50 / 75 / 100% | 视频 id、进度 |
| `form_start` / `field_focus` / `field_done` | 碰表单 | 表单、**栏位名字**（不记录打了什么） |
| `form_submit` / `hs_form_submit` / `lead_submit` / `booking_submit` | 提交 | 转化 |
| 自定义 | `adtTrack('名字')` | 你给的名字和资料 |

**CRM → Analytics tab**：
- 可以切网站
- 时间：今天 / 昨天 / 7 天 / 30 天
- 筛选：来源 / Campaign / Ad set / Ad / 设备
- **导出 Sessions CSV**：一个 session 一行，约 35 个栏位
- **导出 Raw Events CSV**：每个动作一行，最原始的数据

需要分析时，导出这两个 CSV 交给 Sonny / Claude。

---

## 8. 上线前测试清单（每个客户都要做）

- [ ] `https://网址/api/lead` → `"crm": true`、`CRM_PASSWORD: true`
- [ ] 用**手机**、用带广告参数的网址打开（例如在 Ads Manager 按 Preview）
- [ ] 点按钮、往下滑、看一下视频、填表提交
- [ ] `/crm` → 预约名单：出现这个 lead，**Ad account / Campaign / Ad set / Ad + ID 都有显示**
- [ ] `/crm` → Analytics：切到这个客户的网站，看到这次访问、点击、转化
- [ ] Meta Events Manager → **Test events**（先填 `META_TEST_EVENT_CODE`）：看到 Browser 和 Server 两条事件，显示 **Deduplicated**
- [ ] 测完：删掉 `META_TEST_EVENT_CODE` → Redeploy，在 CRM 把测试 lead 标成「不合适」
- [ ] 用 Facebook / Instagram App 里的广告预览再走一次（in-app browser）

---

## 9. 注意事项

- **Vercel Hobby（免费）**：Blob 每月 **2,000 次写入**。大约每个页面浏览 1 次，每个 lead 再 1 次。用完会**锁住储存 30 天，CRM 也会停**。客户开始大量投放前，要先升级 **Pro**
- **CAPI token、CRM 密码**：只放在 Vercel / `.env`，不要发到 WhatsApp 群、不要放进代码、不要截图
- **客户资料是个人资料**：CRM 密码只给负责的人；在客户网站的 Privacy Policy 提到「网站分析」和「资料用途」
- **不记录**客户在表单里打的字（Analytics 只记录栏位名字）；CRM 只保存客户按下提交的资料
- 想关掉 Analytics：`ANALYTICS_ENABLED=0`

---

## 10. 常见问题

| 状况 | 原因 / 解决 |
|---|---|
| `/crm` 说密码不对 | `CRM_PASSWORD` 没设，或设了还没 Redeploy |
| `/api/lead` 显示 `"crm": false` | Blob 没连到这个 project → Storage → Connect；连好后 Redeploy |
| CRM 有 lead 但没有广告来源 | Ad 没贴 URL parameters，或客户不是从广告进来的 |
| 广告来源显示 `{{ad.name}}` 这种字 | 参数打错了（要两个大括号，名字要对） |
| HubSpot 提交了，CRM 没有 | ① 没加 `data-hubspot-leads="1"` ② `data-site` 没在 `ANALYTICS_SITES` 里 ③ 表单没有名字 / 电话 / Email ④ 我们的系统没有 HTTPS |
| Analytics 一直是 0 | `data-site` 跟 CRM 切换的网站不一样；或 `ANALYTICS_ENABLED=0` |
| Meta 转化算两次 | 客户原本的 Pixel 也在发 Lead，见 5.4 |
| Vercel 发 email 说 Blob 快用完 | 马上升级 Pro |

有问题，把 Vercel → **Logs** 的错误讯息截图给 Sonny。
