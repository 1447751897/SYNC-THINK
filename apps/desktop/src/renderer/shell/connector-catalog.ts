import bilibiliIcon from './assets/connectors/bilibili.png';
import captchaIcon from './assets/connectors/captcha.png';
import douyinIcon from './assets/connectors/douyin.png';
import instagramIcon from './assets/connectors/instagram.png';
import kuaishouIcon from './assets/connectors/kuaishou.png';
import lemon8Icon from './assets/connectors/lemon8.png';
import linkedinIcon from './assets/connectors/linkedin.png';
import mixedLinkIcon from './assets/connectors/mixed-link.png';
import neteaseMusicIcon from './assets/connectors/netease-music.png';
import pipixiaIcon from './assets/connectors/pipixia.png';
import qichachaIcon from './assets/connectors/qichacha.png';
import redditIcon from './assets/connectors/reddit.png';
import sora2Icon from './assets/connectors/sora-2.png';
import telegramIcon from './assets/connectors/telegram.png';
import tempMailIcon from './assets/connectors/temp-mail.png';
import threadsIcon from './assets/connectors/threads.png';
import tiktokIcon from './assets/connectors/tiktok.png';
import toutiaoIcon from './assets/connectors/toutiao.png';
import wechatChannelsIcon from './assets/connectors/wechat-channels.png';
import wechatOfficialIcon from './assets/connectors/wechat-official.png';
import wechatSearchIcon from './assets/connectors/wechat-search.png';
import weiboIcon from './assets/connectors/weibo.png';
import xTwitterIcon from './assets/connectors/x-twitter.png';
import xiaohongshuIcon from './assets/connectors/xiaohongshu.png';
import xiguaIcon from './assets/connectors/xigua.png';
import youtubeIcon from './assets/connectors/youtube.png';
import zhihuIcon from './assets/connectors/zhihu.png';

export interface ManagedConnectorCatalogItem {
  id: string;
  name: string;
  icon: string;
}

// Row-major order mirrors NewMax's three-column catalog at the reference width.
export const NEWMAX_CONNECTOR_CATALOG: readonly ManagedConnectorCatalogItem[] = [
  { id: 'douyin', name: '抖音', icon: douyinIcon },
  { id: 'tiktok', name: 'TikTok', icon: tiktokIcon },
  { id: 'qichacha', name: '企查查', icon: qichachaIcon },
  { id: 'instagram', name: 'Instagram', icon: instagramIcon },
  { id: 'xiaohongshu', name: '小红书', icon: xiaohongshuIcon },
  { id: 'weibo', name: '微博', icon: weiboIcon },
  { id: 'youtube', name: 'YouTube', icon: youtubeIcon },
  { id: 'kuaishou', name: '快手', icon: kuaishouIcon },
  { id: 'zhihu', name: '知乎', icon: zhihuIcon },
  { id: 'bilibili', name: '哔哩哔哩', icon: bilibiliIcon },
  { id: 'linkedin', name: 'LinkedIn', icon: linkedinIcon },
  { id: 'reddit', name: 'Reddit', icon: redditIcon },
  { id: 'wechat-official', name: '微信公众号', icon: wechatOfficialIcon },
  { id: 'pipixia', name: '皮皮虾', icon: pipixiaIcon },
  { id: 'sora-2', name: 'Sora 2', icon: sora2Icon },
  { id: 'lemon8', name: 'Lemon8', icon: lemon8Icon },
  { id: 'netease-music', name: '网易云音乐', icon: neteaseMusicIcon },
  { id: 'wechat-channels', name: '微信视频号', icon: wechatChannelsIcon },
  { id: 'x-twitter', name: 'X（Twitter）', icon: xTwitterIcon },
  { id: 'threads', name: 'Threads', icon: threadsIcon },
  { id: 'telegram', name: 'Telegram', icon: telegramIcon },
  { id: 'captcha', name: '验证码识别', icon: captchaIcon },
  { id: 'toutiao', name: '今日头条', icon: toutiaoIcon },
  { id: 'xigua', name: '西瓜视频', icon: xiguaIcon },
  { id: 'wechat-search', name: '微信搜一搜', icon: wechatSearchIcon },
  { id: 'temp-mail', name: '临时邮箱', icon: tempMailIcon },
  { id: 'mixed-link', name: '混合链接解析', icon: mixedLinkIcon },
];
