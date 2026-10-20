# ZINE 账号与云同步部署说明

## 1. 复制 Supabase 的公开配置

打开 Supabase 项目：

1. 进入 `Project Settings` -> `API Keys`（部分旧版界面为 `API`）。
2. 复制项目的 publishable key。旧版界面中它叫 anon key。
3. 打开项目里的 `supabase-config.js`，把密钥填进 `anonKey`：

```js
window.ZINE_SUPABASE_CONFIG = {
  url: "https://epoljesqxsyngnprtlqg.supabase.co",
  anonKey: "这里填 publishable key 或 anon key",
};
```

只能使用 publishable/anon key。不要使用 `secret key` 或 `service_role key`，它们会绕过数据库权限保护。

## 2. 创建数据表和媒体存储区

1. 在 Supabase 左侧打开 `SQL Editor`。
2. 新建一个 Query。
3. 打开项目里的 `supabase.sql`，复制全部内容并运行。

运行后会创建：

- `zine_records`：按用户保存书籍、日记、纪念日和章节页面。
- `zine-media`：保存账号中的视频文件。
- 行级安全策略：每个登录用户只能读取和修改自己的数据。

## 3. 设置登录回调地址

在 Supabase 打开 `Authentication` -> `URL Configuration`：

- `Site URL` 填：`https://cosmic-douhua-71f371.netlify.app`
- `Redirect URLs` 添加：
  - `https://cosmic-douhua-71f371.netlify.app/**`
  - `http://127.0.0.1:8765/**`（本地测试时使用）

## 4. 选择注册确认方式

在 `Authentication` -> `Providers` -> `Email` 中：

- 希望用户注册后必须验证邮箱：保持 `Confirm email` 开启。
- 作业演示时希望注册后直接登录：关闭 `Confirm email`。

## 5. 重新部署

把本次修改提交并推送到 GitHub，等待 Netlify 自动重新部署。如果 Netlify 不是从 Git 自动部署，则重新上传当前项目目录。

部署完成后打开：

`https://cosmic-douhua-71f371.netlify.app/me.html`

点击“登录或创建账号”，注册一个测试账号。登录后写一篇日记，再用另一台设备或无痕窗口登录同一账号，确认内容可以读取。

## 现有记录会怎样

- 未登录时，网站继续把记录保存在当前浏览器。
- 第一次登录一个还没有云端记录的新账号时，当前浏览器已有的 ZINE 记录会上传到该账号。
- 账号已有云端记录时，登录后会优先读取账号里的内容。
