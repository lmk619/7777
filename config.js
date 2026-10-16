/* 出师吧 · 公开配置
 *
 * 这里只放"公开信息"，不放任何密码或密钥：
 *   envId     云开发环境 ID（在 CloudBase 控制台首页能看到，形如 prentice-1a2b3c）。它本来就会出现在浏览器请求里，不是秘密。
 *   region    环境所在地域，默认上海 ap-shanghai。必须和你建环境时选的一致。
 *   accessKey 可选。控制台 → 环境配置 → API Key 里的"Publishable Key"（可公开的那种）；没有就留空。
 *
 * envId 留空时，网站自动回到原来的"本机演示模式"（账号和进度只存在浏览器里），不会坏。
 * 千万不要把 SecretId / SecretKey / 数据库密码 / DeepSeek Key 写进这个文件。
 */
window.PRENTICE_CONFIG = {
  envId: '',
  region: 'ap-shanghai',
  accessKey: ''
};
