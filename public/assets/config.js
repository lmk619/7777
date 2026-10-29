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
  envId: 'chushiba-d0gjks4hh2f41cc8e',
  region: 'ap-shanghai',
  accessKey: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkMWRjMzFlLWI0ZDAtNDQ4Yi1hNzZmLWIwY2M2M2Q4MTQ5OCJ9.eyJpc3MiOiJodHRwczovL2NodXNoaWJhLWQwZ2prczRoaDJmNDFjYzhlLmFwLXNoYW5naGFpLnRjYi1hcGkudGVuY2VudGNsb3VkYXBpLmNvbSIsInN1YiI6ImFub24iLCJhdWQiOiJjaHVzaGliYS1kMGdqa3M0aGgyZjQxY2M4ZSIsImV4cCI6NDA5Njk3NjAyNSwiaWF0IjoxNzkzMjkyODI1LCJub25jZSI6IlVZb1dCTTVGVHFtV3duaV9mMlhQd2ciLCJhdF9oYXNoIjoiVVlvV0JNNUZUcW1Xd25pX2YyWFB3ZyIsIm5hbWUiOiJBbm9ueW1vdXMiLCJzY29wZSI6ImFub255bW91cyIsInByb2plY3RfaWQiOiJjaHVzaGliYS1kMGdqa3M0aGgyZjQxY2M4ZSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF91c2VyIiwiaXNfc3lzdGVtX2FkbWluIjpmYWxzZX0.I3CsLEPaANjf3-9GyRzycOnqR_O6CTDuwfx0Hkk_l-TdtfFBCqSqnZNOx4KZZz5iaz6IZCYB_8h5JIvh9ESQvNgfycH16r5JiF90EhnmK7wseAJUakM4agOJMjffweaZ-guCZEwCXZLU-XldBz-ISBjD3VZski9pfUAmIEgy6qIreogQ1srzF6VkHHXFBSZ07A71PgOfqlHwzZ2eA2HkwfTnAILRC3MTbtZjTeRB9h4PfeVbIkPBdV2rR-owmgF2qV2SbvZyKlQWlxsT0mYf0tHLkHheEkBWX91Pa0XpoNPYCpLeei9vD5BEhviMmHFh1fhVMfVMI4xShvxN-2VQkw'
};
