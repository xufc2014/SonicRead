/**
 * media-session.js - renderjs 模块：注册系统媒体会话（MediaSession）
 *
 * 作用：让系统"媒体中心/通知栏"识别本 APP 正在播放媒体：
 * - 显示当前播放的集数与书名（MediaMetadata）
 * - 播放/暂停/上一首/下一首/拖动 控制（setActionHandler → 桥接逻辑层）
 * - 系统把本进程视为"活动媒体应用"，降低被省电冻结的概率
 *
 * 注意：这是 HTML5 Media Session API（webview 能力），云打包即可用，
 * 无需原生插件。显示效果依赖系统版本（Android 8+ 支持）。
 */

export default {
  data() {
    return {
      mediaInfo: null // 逻辑层通过 :media-info prop 推送 { title, playing, position, duration }
    }
  },

  mounted() {
    // 检测系统是否支持媒体会话
    this.mediaSupported = typeof navigator !== 'undefined' && 'mediaSession' in navigator
    this.handlersRegistered = false
  },

  watch: {
    // 逻辑层推送的媒体状态变化 → 同步给系统
    mediaInfo(info) {
      if (!info || !this.mediaSupported) return
      try {
        // 更新元数据（标题 = 当前集数 + 书名）
        if (info.title) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: info.title,
            artist: 'SonicRead 有声小说',
            album: ''
          })
        }
        // 播放状态（决定媒体卡片上的播放/暂停图标）
        navigator.mediaSession.playbackState = info.playing ? 'playing' : 'paused'
        // 注册控制回调（只需一次）
        this.registerHandlers()
      } catch (e) {
        // 系统不支持时静默
      }
    }
  },

  methods: {
    // 注册播放控制回调，全部桥接回逻辑层
    registerHandlers() {
      if (this.handlersRegistered) return
      this.handlersRegistered = true
      const call = (action, extra) => {
        try {
          this.$ownerInstance.callMethod('onMediaSessionAction', Object.assign({ action: action }, extra || {}))
        } catch (e) {
          // 忽略
        }
      }
      try {
        navigator.mediaSession.setActionHandler('play', () => call('play'))
        navigator.mediaSession.setActionHandler('pause', () => call('pause'))
        navigator.mediaSession.setActionHandler('previoustrack', () => call('prev'))
        navigator.mediaSession.setActionHandler('nexttrack', () => call('next'))
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details && typeof details.seekTime === 'number') {
            call('seek', { seekTime: details.seekTime })
          }
        })
      } catch (e) {
        // 个别 action 不支持时忽略
      }
    }
  }
}
