# Publishing the extension

What the Chrome Web Store and Microsoft Edge Add-ons ask for, ready to paste. The package is the same for both: `public/betterhuskyct-extension.zip`, made by `npm run build` (or `node scripts/build-extension.mjs`).

- Icons are in `icons/` (16, 48, 128) and in the manifest.
- Screenshots are in `store/`: the overview, to-do, announcements, grades and materials pages (five, the most Chrome takes), 1280×800 and 24-bit, English and 简体中文. They show made-up data (no real student's), loaded through a `#sync=` link into a local `npm run dev`; retake them whenever the pages change enough to look different.
- The privacy policy is the site's `/privacy` page, `https://betterhuskyct.vercel.app/privacy` (the same text as `PRIVACY.md` at the repository root). GitHub's own page for that file answers 503 to a checker when it is rate limited, which a store reads as an invalid address; `https://raw.githubusercontent.com/NoGod3524/betterhuskyct/main/PRIVACY.md` works as a fallback.
- A new version is the helper's `@version` raised, then the build, then **Upload new package** in each dashboard.

## Accounts

- **Chrome Web Store**: <https://chrome.google.com/webstore/devconsole>. One-time registration fee of US$5. Use a personal Google account, not a school one: the account owns the listing.
- **Microsoft Edge Add-ons**: <https://partner.microsoft.com/dashboard/microsoftedge/overview>. Free. Register as an individual.

## Listing

**Name:** BetterHuskyCT Helper

**Summary (132 characters at most):**
Reads your HuskyCT deadlines, announcements, grades and files in your own browser and hands them to BetterHuskyCT.

**Description:**

> BetterHuskyCT Helper connects UConn's HuskyCT (Blackboard Ultra) to BetterHuskyCT, a dashboard for your deadlines, announcements, grades and course files.
>
> HuskyCT shows these things on different pages, one course at a time. With the helper installed, press Sync on BetterHuskyCT (or just open HuskyCT) and it reads your courses, to-do list and due dates, announcements, gradebook and course files, using the session your browser already has, and hands them to BetterHuskyCT.
>
> Optional background sync checks about every six hours while your browser runs, even with both sites closed. Course changes wait locally for your next visit. Optional system notifications show course updates; both features start off. If your HuskyCT session expires, checks pause and you are asked to sign in again. Background sync updates file directories; use Sync to download file contents.
>
> Private by design: it never asks for or stores your NetID, password or cookies; it talks only to lms.uconn.edu; it has no analytics or tracking; and what it reads stays in your browser. It is free, open source (MIT), and has no ads, sign-up or tracking; every release can be checked against the public code.
>
> This is an unofficial tool and is not affiliated with the University of Connecticut or Blackboard.

**描述（简体中文）：**

> BetterHuskyCT Helper 把 UConn 的 HuskyCT（Blackboard Ultra）连到 BetterHuskyCT，一个汇总截止日期、公告、成绩和课件的仪表盘。
>
> HuskyCT 把这些内容分散在不同页面、一门课一门课地看。装上助手后，在 BetterHuskyCT 点「同步」（或直接打开 HuskyCT），它会用你浏览器里已有的登录状态读取课程、待办和截止日期、公告、成绩和课件，并交给 BetterHuskyCT。
>
> 可选的后台同步会在浏览器运行时大约每六小时检查一次，即使两个站点都没打开。课程变化先保存在本机，等下次打开网站时交给你；还可选择开启系统通知。这两项默认关闭。HuskyCT 登录失效时会暂停检查，提示你重新登录。后台更新课件目录，文件内容仍由「同步」下载。
>
> 隐私优先：不会索取或保存你的 NetID、密码和 cookie；只和 lms.uconn.edu 通信；没有统计和跟踪；读到的内容留在你的浏览器里。免费、开源（MIT），没有广告、不需注册、不追踪；每个发布版本都能对照公开代码核对。
>
> 这是非官方工具，与康涅狄格大学和 Blackboard 无关。

**Category:** Productivity (Chrome) / Productivity (Edge). **Language:** English, 中文 (简体).

## Chrome Web Store: privacy tab

**Single purpose:** Read the signed-in student's own HuskyCT data in the browser and hand it to the BetterHuskyCT dashboard.

**Permission justifications**

- `storage` and `unlimitedStorage`: keep what was read, including course files the student asks for, on the device. File contents can exceed the default storage quota.
- `scripting`: run the bundled helper in the HuskyCT and BetterHuskyCT pages (it needs the page's own session to read HuskyCT).
- `alarms`: schedule optional background checks about every six hours while the browser runs.
- `offscreen`: run the same bundled API reader in a document with DOM support while no HuskyCT page is open.
- `notifications` (optional): show local course-update and sign-in reminders after the student enables them. Previews may contain course names and item titles. This is not a push service.
- Host access to `https://lms.uconn.edu/*` and `https://huskyct.uconn.edu/*`: read HuskyCT. `https://betterhuskyct.vercel.app/*`: receive the result and start a sync from its Sync button.

**Remote code:** none. All code is in the package.

**Data use disclosures** (tick only what applies): *Personally identifiable information*, *Authentication information* no; *Personal communications* (course announcements) and *Website content* yes — and certify that it is not sold, not used for unrelated purposes, and not used for creditworthiness or lending. Say that it is not transmitted off the device by the extension.

## Edge Add-ons

The same package and text. Its "Notes for certification" field: *Sign-in to lms.uconn.edu needs a UConn NetID, so the reviewer cannot sign in; the helper reads only after sign-in. The source is at https://github.com/NoGod3524/betterhuskyct/tree/main/tools/extension and tools/huskyct-helper.*

A reviewer without a UConn account cannot see the helper work. Expect questions, or a rejection, over that; the answer is the open source and the privacy policy, and offering a short screen recording.
