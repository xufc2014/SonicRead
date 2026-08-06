<script>
import { log } from './utils/logger.js'
export default {
  onLaunch: function () {
    // 进程级启动：出现这条 = 冷启动（进程被杀后重启）；没有 = 页面热重建
    // #ifdef APP-PLUS
    log('[APP] 进程启动（冷启动）')
    // #endif
  },
  onShow: function () {
    // 从后台回到前台（如授权设置页返回），页面自行处理重扫
  }
}
</script>

<style>
/* 全局样式 */
page {
  background-color: #f6f7f9;
}
</style>
