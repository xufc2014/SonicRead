<template>
  <view class="page">
    <!-- ========== 顶部栏 ========== -->
    <view class="header">
      <text class="header-title">📖 我的小说</text>
      <view class="header-actions">
        <view class="refresh-btn" @click="openDirPicker">📁 选目录</view>
        <view class="refresh-btn" @click="onRefresh">🔄 刷新</view>
      </view>
    </view>

    <!-- ========== 权限引导 ========== -->
    <view class="perm-banner" v-if="needPermission">
      <text class="perm-text">需要存储权限才能读取小说文件</text>
      <view class="perm-btn" @click="goPermissionSettings">去授权</view>
    </view>

    <!-- ========== 当前目录 ========== -->
    <view class="dir-bar" v-if="novelDir && !dirPickerVisible" @click="openDirPicker">
      <text class="dir-label">📁</text>
      <text class="dir-path">{{ novelDir }}</text>
    </view>

    <!-- ========== 空状态 ========== -->
    <view class="empty" v-if="!loading && playlist.length === 0 && !dirPickerVisible">
      <text class="empty-icon">🎧</text>
      <text class="empty-text">{{ novelDir ? '未找到 MP3 文件' : '请选择一个小说文件夹' }}</text>
      <text class="empty-sub">{{ novelDir ? '当前目录下没有 .mp3 文件' : '选择包含 MP3 小说的文件夹后自动扫描' }}</text>
      <view class="empty-btn" @click="openDirPicker">{{ novelDir ? '重新选择目录' : '选择文件夹' }}</view>
    </view>

    <!-- ========== 文件列表 ========== -->
    <scroll-view class="list" scroll-y :show-scrollbar="false">
      <view
        v-for="(item, idx) in playlist"
        :key="item.fullName"
        class="list-item"
        :class="{ active: idx === currentIndex }"
        @click="playFrom(idx)"
      >
        <text class="item-play-icon" v-if="idx === currentIndex">{{ isPlaying ? '▶' : '❚❚' }}</text>
        <text class="item-name" :class="{ 'item-name-active': idx === currentIndex }">{{ item.name }}</text>
        <text class="item-duration">{{ formatDuration(item.duration) }}</text>
      </view>
      <view class="list-bottom" v-if="loading">扫描中...</view>
    </scroll-view>

    <!-- ========== 底部播放控制 ========== -->
    <view class="player" v-if="playlist.length > 0">
      <text class="now-playing" :class="{ 'now-playing-empty': !playlist[currentIndex] }">
        {{ playlist[currentIndex] ? playlist[currentIndex].name : '--' }}
      </text>
      <view class="progress-row">
        <text class="time">{{ formatDuration(currentTime) }}</text>
        <slider
          class="progress"
          :value="currentTime"
          :max="duration > 0 ? duration : 1"
          :disabled="!playlist[currentIndex]"
          activeColor="#3478f6"
          backgroundColor="#e0e0e0"
          block-size="16"
          @changing="onSeeking"
          @change="onSeek"
        />
        <text class="time">{{ formatDuration(duration) }}</text>
      </view>
      <view class="controls">
        <view class="ctrl-btn" @click="prev">⏮</view>
        <view class="ctrl-btn ctrl-main" @click="togglePlay">{{ isPlaying ? '⏸' : '▶' }}</view>
        <view class="ctrl-btn" @click="next">⏭</view>
      </view>
    </view>

    <!-- ========== 轻提示（静音跳转等） ========== -->
    <view class="toast" v-if="toast">{{ toast }}</view>

    <!-- ========== 目录选择面板 ========== -->
    <view class="mask" v-if="dirPickerVisible" @click="closeDirPicker">
      <view class="picker" @click.stop>
        <view class="picker-header">
          <text class="picker-title">选择小说目录</text>
          <view class="picker-cancel" @click="closeDirPicker">取消</view>
        </view>
        <view class="picker-path-row">
          <text class="picker-path">{{ pickerPath }}</text>
          <text class="picker-count">{{ pickerMp3Count }} 个 MP3</text>
        </view>
        <scroll-view class="picker-list" scroll-y :show-scrollbar="false">
          <view class="picker-item" v-if="!isRoot" @click="goUp">
            <text class="picker-ico">⬆️</text>
            <text class="picker-name">返回上级目录</text>
          </view>
          <view class="picker-item" v-for="d in pickerDirs" :key="d" @click="enterDir(d)">
            <text class="picker-ico">📁</text>
            <text class="picker-name">{{ d }}</text>
          </view>
          <view class="picker-empty" v-if="pickerDirs.length === 0 && !pickerBusy">
            <text>该目录下没有子文件夹</text>
          </view>
        </scroll-view>
        <view class="picker-footer">
          <view class="picker-use-btn" @click="useDir">使用此目录</view>
        </view>
      </view>
    </view>

    <!-- ========== renderjs 承载节点（静音分析） ========== -->
    <!-- 通过 :analyze prop 把 { index, base64 } 传给 renderjs 层 -->
    <view ref="silenceView" :analyze="analyzePayload" class="renderjs-host"></view>
  </view>
</template>

<script>
/**
 * 逻辑层（App 服务层）
 * - 用户自选小说目录（内置目录浏览器，java.io 实现）
 * - InnerAudioContext 原生播放
 * - 播放前把 MP3 读成 base64 交给 renderjs 预分析静音位置
 * - 播放进度到达 silenceStart 自动切下一集
 */
const STORAGE_KEY_DIR = 'sonic_novel_dir' // 播放记忆：小说目录
const STORAGE_KEY_INDEX = 'sonic_play_index' // 播放记忆：文件索引
const STORAGE_KEY_TIME = 'sonic_play_time' // 播放记忆：进度（秒）
const SWITCH_DEBOUNCE = 500 // 切歌防抖（ms）

export default {
  data() {
    return {
      novelDir: '', // 当前小说目录（用户选择，持久化）
      playlist: [], // 文件列表
      currentIndex: -1, // 当前播放索引
      isPlaying: false, // 是否正在播放
      currentTime: 0, // 当前进度（秒）
      duration: 0, // 当前文件总时长（秒）
      loading: false, // 扫描中
      needPermission: false, // 是否缺少存储权限
      toast: '', // 轻提示
      analyzePayload: null, // 传给 renderjs 的分析任务
      // 目录选择面板状态
      dirPickerVisible: false, // 面板是否显示
      pickerPath: '', // 浏览中的路径
      pickerDirs: [], // 子目录列表
      pickerMp3Count: 0, // 当前目录下 MP3 数量
      pickerBusy: false, // 目录加载中
      isRoot: false, // 是否已在根目录
      // 内部状态（不渲染）
      inner: null, // 播放器实例
      seeking: false, // 是否正在拖动进度条
      lastSwitchTime: 0, // 切歌防抖时间戳
      lastSaveTime: 0 // 进度保存节流时间戳
    }
  },

  onLoad() {
    this.initPlayer()
    // 读取上次选择的小说目录
    this.novelDir = uni.getStorageSync(STORAGE_KEY_DIR) || ''
    this.checkPermissionAndScan()
  },

  // 从系统设置授权页返回时自动重查权限并重扫
  onShow() {
    if (this.needPermission) {
      this.checkPermissionAndScan()
    }
  },

  methods: {
    /* ================= 初始化 ================= */

    initPlayer() {
      const inner = uni.createInnerAudioContext()
      // 注意：obeyMuteSwitch 在 App-Android 端为只读属性，赋值会抛 "only a getter" 错误，故不设置（该属性仅 iOS 有意义）

      // 播放进度监听（500ms 级，拖动中跳过避免抖动）
      inner.onTimeUpdate(() => {
        if (this.seeking) return
        this.currentTime = inner.currentTime
        if (inner.duration && !isNaN(inner.duration)) {
          this.duration = inner.duration
        }
        // 核心：进度到达静音起点 → 自动跳下一集
        const item = this.playlist[this.currentIndex]
        if (item && item.silenceStart > 0 && inner.currentTime >= item.silenceStart) {
          this.next(true)
          return
        }
        // 节流保存播放进度（每 5 秒）
        const now = Date.now()
        if (now - this.lastSaveTime > 5000) {
          this.lastSaveTime = now
          uni.setStorageSync(STORAGE_KEY_TIME, Math.floor(inner.currentTime))
        }
      })

      // 播放完成 → 自动切下一集（自动行为，不参与点击防抖）
      inner.onEnded(() => {
        this.next(true)
      })

      // 播放错误（如文件被删除）→ 跳过该文件
      inner.onError((err) => {
        console.error('[SonicRead] 播放错误', err)
        this.next(true)
      })

      // 播放状态回调
      inner.onPlay(() => { this.isPlaying = true })
      inner.onPause(() => { this.isPlaying = false })
      inner.onStop(() => { this.isPlaying = false })

      this.inner = inner
    },

    /* ================= 权限 ================= */

    checkPermissionAndScan() {
      // #ifdef APP-PLUS
      if (plus.os.name === 'Android') {
        // targetSdk 28 下走传统动态权限申请（模拟器/真机/国产 ROM 都能正常弹窗）
        this.tryLegacyPermission()
      } else {
        this.scanFiles()
      }
      // #endif
      // #ifndef APP-PLUS
      this.scanFiles()
      // #endif
    },

    // 动态申请存储权限（targetSdk 28 + READ/WRITE_EXTERNAL_STORAGE）
    tryLegacyPermission() {
      try {
        plus.android.requestPermissions(
          ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'],
          (result) => {
            // 授权成功（result.granted 包含所需权限）：扫描
            const ok = result && result.granted && result.granted.length > 0
            this.needPermission = !ok
            this.scanFiles()
          },
          (err) => {
            // 用户拒绝：显示引导 banner，让用户走"去授权"跳应用详情
            this.needPermission = true
            this.scanFiles()
          }
        )
      } catch (e) {
        this.scanFiles()
      }
    },

    // 跳转系统设置页手动授权（targetSdk 28：跳应用详情页即可）
    goPermissionSettings() {
      try {
        const main = plus.android.runtimeMainActivity()
        const Intent = plus.android.importClass('android.content.Intent')
        const Settings = plus.android.importClass('android.provider.Settings')
        const Uri = plus.android.importClass('android.net.Uri')
        const intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        intent.setData(Uri.parse('package:' + main.getPackageName()))
        main.startActivity(intent)
      } catch (e) {
        this.showToast('请手动授予存储权限后重试')
      }
    },

    /* ================= 扫描（java.io 方式） ================= */
    /**
     * 说明：targetSdkVersion ≥ 29 后，plus.io 无法通过绝对路径访问外部存储
     * （Android 10+ 分区存储限制，报 code:15）。因此改用 plus.android 反射
     * java.io.File API 扫描目录，完全绕开 plus.io 的路径限制。
     */
    scanFiles() {
      // 还没选目录 → 弹出目录选择器
      if (!this.novelDir) {
        this.openDirPicker()
        return
      }
      this.loading = true
      // #ifdef APP-PLUS
      try {
        const File = plus.android.importClass('java.io.File')
        const dir = new File(this.novelDir)

        // 目录不存在 → 提示重新选择
        if (!dir.exists()) {
          this.loading = false
          this.playlist = []
          this.showToast('目录不存在，请重新选择')
          return
        }

        // 列出目录下所有 MP3 文件
        const list = dir.listFiles()
        const mp3s = []
        if (list) {
          for (let i = 0; i < list.length; i++) {
            const f = list[i]
            const name = f.getName()
            if (f.isFile() && /\.mp3$/i.test(name)) {
              mp3s.push({
                name: name.replace(/\.mp3$/i, ''),
                fullName: name,
                path: f.getAbsolutePath(), // 绝对路径，供播放器直接使用
                duration: 0,
                silenceStart: -1
              })
            }
          }
        }

        // 文件名自然排序（数字顺序：1,2,...10,11）
        mp3s.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }))
        this.playlist = mp3s
        this.loading = false

        if (mp3s.length === 0) {
          this.showToast('未找到 MP3 文件')
          return
        }
        // 后台补全时长（顺序加载，不阻塞列表）
        this.fetchDurations(0)
        // 恢复上次播放位置
        this.restorePlayback()
      } catch (e) {
        console.error('[SonicRead] 扫描目录失败', e)
        this.loading = false
      }
      // #endif
      // #ifndef APP-PLUS
      // 非 App 端（如浏览器预览）：展示空状态
      this.loading = false
      // #endif
    },

    /* ================= 目录选择器（java.io 方式） ================= */

    // 打开目录选择面板，从外部存储根目录开始浏览
    openDirPicker() {
      this.dirPickerVisible = true
      // #ifdef APP-PLUS
      try {
        const Environment = plus.android.importClass('android.os.Environment')
        const root = Environment.getExternalStorageDirectory().getAbsolutePath()
        this.listPickerDir(root)
      } catch (e) {
        this.listPickerDir('/storage/emulated/0/')
      }
      // #endif
    },

    // 列出指定路径下的子目录与 MP3 数量
    listPickerDir(path) {
      this.pickerBusy = true
      // #ifdef APP-PLUS
      try {
        const File = plus.android.importClass('java.io.File')
        const dir = new File(path)
        const dirs = []
        let mp3Count = 0
        if (dir.exists()) {
          const list = dir.listFiles()
          if (list) {
            for (let i = 0; i < list.length; i++) {
              const f = list[i]
              const name = f.getName()
              if (f.isDirectory()) {
                dirs.push(name)
              } else if (/\.mp3$/i.test(name)) {
                mp3Count++
              }
            }
          }
        }
        dirs.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
        this.pickerPath = path
        this.pickerDirs = dirs
        this.pickerMp3Count = mp3Count
        this.isRoot = path === '/' || path === ''
      } catch (e) {
        console.error('[SonicRead] 列出目录失败', e)
        this.pickerDirs = []
        this.pickerMp3Count = 0
      }
      // #endif
      this.pickerBusy = false
    },

    // 返回上级目录
    goUp() {
      // #ifdef APP-PLUS
      const File = plus.android.importClass('java.io.File')
      const dir = new File(this.pickerPath)
      const parent = dir.getParentFile()
      this.listPickerDir(parent ? parent.getAbsolutePath() : '/')
      // #endif
    },

    // 进入子目录
    enterDir(name) {
      const sep = this.pickerPath.endsWith('/') ? '' : '/'
      this.listPickerDir(this.pickerPath + sep + name)
    },

    // 确认使用当前目录并扫描
    useDir() {
      if (!this.pickerPath) return
      this.novelDir = this.pickerPath
      uni.setStorageSync(STORAGE_KEY_DIR, this.pickerPath)
      this.dirPickerVisible = false
      // 清空旧列表与播放状态
      this.playlist = []
      this.currentIndex = -1
      this.currentTime = 0
      this.duration = 0
      this.inner.stop()
      this.scanFiles()
    },

    // 关闭目录选择面板
    closeDirPicker() {
      this.dirPickerVisible = false
    },

    /**
     * 读取文件为 base64（java.io 方式，绕开 plus.io 路径限制）
     * @param {string} path 文件绝对路径
     * @returns {Promise<string>} base64 字符串
     */
    readFileBase64(path) {
      return new Promise((resolve, reject) => {
        try {
          const FileInputStream = plus.android.importClass('java.io.FileInputStream')
          const ByteArrayOutputStream = plus.android.importClass('java.io.ByteArrayOutputStream')
          const Base64 = plus.android.importClass('android.util.Base64')
          const fis = new FileInputStream(path)
          const bos = new ByteArrayOutputStream()
          // 创建 64KB 的 Java byte[] 缓冲区
          const buffer = plus.android.newObject('[B', 65536)
          let len = fis.read(buffer)
          while (len > 0) {
            bos.write(buffer, 0, len)
            len = fis.read(buffer)
          }
          fis.close()
          const bytes = bos.toByteArray() // Java byte[] → JS 数字数组
          bos.close()
          // NO_WRAP=2，编码结果不带换行
          const b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
          resolve(b64)
        } catch (e) {
          reject(e)
        }
      })
    },

    // 逐个加载文件时长（异步补全）
    fetchDurations(i) {
      if (i >= this.playlist.length) return
      const item = this.playlist[i]
      const ctx = uni.createInnerAudioContext()
      ctx.src = 'file://' + item.path
      let done = false
      const finish = () => {
        if (done) return
        done = true
        ctx.destroy()
        this.fetchDurations(i + 1)
      }
      ctx.onCanplay(() => {
        if (ctx.duration && !isNaN(ctx.duration)) {
          item.duration = Math.round(ctx.duration)
        }
        finish()
      })
      ctx.onError(() => { finish() })
      // 超时保护：3 秒拿不到时长就跳过
      setTimeout(finish, 3000)
    },

    /* ================= 播放控制 ================= */

    playFrom(idx) {
      if (idx < 0 || idx >= this.playlist.length) return
      this.currentIndex = idx
      this.currentTime = 0
      this.inner.src = 'file://' + this.playlist[idx].path
      this.inner.play()
      this.saveIndex()
      // 预分析静音位置（不阻塞播放）
      this.analyzeSilence(idx)
    },

    togglePlay() {
      if (this.currentIndex < 0) {
        if (this.playlist.length > 0) this.playFrom(0)
        return
      }
      if (this.isPlaying) {
        this.inner.pause()
      } else {
        this.inner.play()
      }
    },

    prev() {
      if (this.playlist.length === 0) return
      if (!this.checkDebounce()) return
      const idx = this.currentIndex > 0 ? this.currentIndex - 1 : 0
      this.playFrom(idx)
    },

    /**
     * 下一首
     * @param {boolean} isAuto true=自动行为（静音跳转/自然播完，不参与点击防抖）
     */
    next(isAuto) {
      if (this.playlist.length === 0) return
      if (!isAuto && !this.checkDebounce()) return
      // 自动行为或播完：如果当前集在列表末尾则停止
      if (this.currentIndex >= this.playlist.length - 1) {
        if (isAuto || this.isPlaying) {
          this.inner.stop()
          this.showToast('已全部播完')
        }
        return
      }
      if (isAuto) {
        this.showToast('检测到静音，自动跳转下一集')
      }
      this.playFrom(this.currentIndex + 1)
    },

    // 切歌防抖：500ms 内仅生效一次
    checkDebounce() {
      const now = Date.now()
      if (now - this.lastSwitchTime < SWITCH_DEBOUNCE) return false
      this.lastSwitchTime = now
      return true
    },

    /* ================= 进度控制 ================= */

    onSeeking(e) {
      this.seeking = true
      this.currentTime = e.detail.value
    },

    onSeek(e) {
      const t = e.detail.value
      this.currentTime = t
      this.inner.seek(t)
      this.seeking = false
      // 用户主动拖入静音段 → 立即切歌（视为主动跳过静音）
      const item = this.playlist[this.currentIndex]
      if (item && item.silenceStart > 0 && t >= item.silenceStart) {
        this.next(true)
      }
    },

    /* ================= 静音分析 ================= */

    /**
     * 预分析：读取 MP3 为 base64 → 传给 renderjs 解码分析
     * 分析结果通过 onSilenceAnalyzed 回调回来
     */
    analyzeSilence(idx) {
      const item = this.playlist[idx]
      if (!item) return
      // #ifdef APP-PLUS
      this.readFileBase64(item.path)
        .then((base64) => {
          // 触发 renderjs watch，开始分析（base64 为纯编码串，无 data: 前缀）
          this.analyzePayload = { index: idx, base64: base64 }
        })
        .catch((err) => {
          console.error('[SonicRead] 读取文件失败', err)
        })
      // #endif
    },

    /**
     * renderjs 分析完成的回调（由 renderjs 的 $ownerInstance.callMethod 触发）
     * @param {Object} res { index, silenceStart }
     */
    onSilenceAnalyzed(res) {
      const item = this.playlist[res.index]
      if (item) {
        item.silenceStart = res.silenceStart
        console.log('[SonicRead] 第' + (res.index + 1) + '集 静音起点:', res.silenceStart, '秒')
      }
    },

    /* ================= 播放记忆 ================= */

    saveIndex() {
      uni.setStorageSync(STORAGE_KEY_INDEX, this.currentIndex)
    },

    restorePlayback() {
      if (this.playlist.length === 0) return
      const savedIndex = uni.getStorageSync(STORAGE_KEY_INDEX)
      const savedTime = uni.getStorageSync(STORAGE_KEY_TIME) || 0
      const idx =
        typeof savedIndex === 'number' && savedIndex >= 0 && savedIndex < this.playlist.length
          ? savedIndex
          : 0
      // 自动续播上次进度
      this.currentIndex = idx
      this.inner.src = 'file://' + this.playlist[idx].path
      this.inner.play()
      if (savedTime > 0) {
        this.inner.seek(savedTime)
      }
      this.analyzeSilence(idx)
    },

    /* ================= 其他 ================= */

    onRefresh() {
      if (!this.novelDir) {
        this.openDirPicker()
        return
      }
      this.scanFiles()
    },

    formatDuration(sec) {
      if (!sec || isNaN(sec)) return '00:00'
      const total = Math.floor(sec)
      const m = Math.floor(total / 60)
      const s = total % 60
      return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s)
    },

    // 轻提示：2 秒后消失
    showToast(msg) {
      this.toast = msg
      if (this.toastTimer) clearTimeout(this.toastTimer)
      this.toastTimer = setTimeout(() => {
        this.toast = ''
      }, 2000)
    }
  }
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f6f7f9;
  box-sizing: border-box;
}

/* ---------- 顶部栏 ---------- */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx;
  background-color: #ffffff;
  border-bottom: 1rpx solid #eeeeee;
  flex-shrink: 0;
}
.header-title {
  font-size: 36rpx;
  font-weight: 600;
  color: #222222;
}
.header-actions {
  display: flex;
  align-items: center;
}
.refresh-btn {
  font-size: 28rpx;
  color: #3478f6;
  padding: 8rpx 20rpx;
  border: 1rpx solid #3478f6;
  border-radius: 32rpx;
  margin-left: 16rpx;
}

/* ---------- 当前目录 ---------- */
.dir-bar {
  display: flex;
  align-items: center;
  padding: 14rpx 32rpx;
  background-color: #f0f5ff;
  border-bottom: 1rpx solid #e3ecff;
  flex-shrink: 0;
}
.dir-label {
  font-size: 24rpx;
  margin-right: 10rpx;
}
.dir-path {
  flex: 1;
  font-size: 24rpx;
  color: #4a6fb5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 目录选择面板 ---------- */
.mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.picker {
  background-color: #ffffff;
  border-radius: 32rpx 32rpx 0 0;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  padding: 24rpx 0 40rpx;
}
.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx 32rpx 16rpx;
}
.picker-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #222222;
}
.picker-cancel {
  font-size: 28rpx;
  color: #999999;
  padding: 8rpx;
}
.picker-path-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 32rpx;
  background-color: #f6f7f9;
  border-bottom: 1rpx solid #eeeeee;
}
.picker-path {
  flex: 1;
  font-size: 24rpx;
  color: #666666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-count {
  font-size: 22rpx;
  color: #3478f6;
  margin-left: 16rpx;
  flex-shrink: 0;
}
.picker-list {
  flex: 1;
  min-height: 320rpx;
  max-height: 52vh;
}
.picker-item {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx;
  border-bottom: 1rpx solid #f5f5f5;
}
.picker-ico {
  font-size: 28rpx;
  margin-right: 16rpx;
}
.picker-name {
  flex: 1;
  font-size: 28rpx;
  color: #333333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-empty {
  padding: 60rpx 0;
  text-align: center;
  font-size: 26rpx;
  color: #999999;
}
.picker-footer {
  padding: 20rpx 32rpx 0;
}
.picker-use-btn {
  background-color: #3478f6;
  color: #ffffff;
  font-size: 30rpx;
  text-align: center;
  padding: 20rpx 0;
  border-radius: 44rpx;
}

/* ---------- 权限引导 ---------- */
.perm-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 32rpx;
  background-color: #fff7e6;
  border-bottom: 1rpx solid #ffe7ba;
  flex-shrink: 0;
}
.perm-text {
  font-size: 24rpx;
  color: #b8860b;
  flex: 1;
}
.perm-btn {
  font-size: 24rpx;
  color: #ffffff;
  background-color: #f0ad4e;
  padding: 8rpx 24rpx;
  border-radius: 28rpx;
  margin-left: 20rpx;
}

/* ---------- 空状态 ---------- */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
  flex: 1;
}
.empty-icon {
  font-size: 100rpx;
  margin-bottom: 24rpx;
}
.empty-text {
  font-size: 32rpx;
  color: #666666;
  margin-bottom: 12rpx;
}
.empty-sub {
  font-size: 24rpx;
  color: #999999;
  margin-bottom: 40rpx;
}
.empty-btn {
  font-size: 28rpx;
  color: #ffffff;
  background-color: #3478f6;
  padding: 16rpx 48rpx;
  border-radius: 40rpx;
}

/* ---------- 文件列表 ---------- */
.list {
  flex: 1;
  min-height: 0;
}
.list-item {
  display: flex;
  align-items: center;
  padding: 26rpx 32rpx;
  background-color: #ffffff;
  border-bottom: 1rpx solid #f0f0f0;
}
.list-item.active {
  background-color: #eef4ff;
}
.item-play-icon {
  font-size: 24rpx;
  color: #3478f6;
  width: 56rpx;
  flex-shrink: 0;
}
.item-name {
  flex: 1;
  font-size: 30rpx;
  color: #333333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-name-active {
  color: #3478f6;
  font-weight: 600;
}
.item-duration {
  font-size: 24rpx;
  color: #999999;
  margin-left: 16rpx;
  flex-shrink: 0;
}
.list-bottom {
  padding: 32rpx;
  text-align: center;
  font-size: 26rpx;
  color: #999999;
}

/* ---------- 底部播放器 ---------- */
.player {
  background-color: #ffffff;
  border-top: 1rpx solid #eeeeee;
  padding: 20rpx 32rpx 40rpx;
  flex-shrink: 0;
}
.now-playing {
  display: block;
  text-align: center;
  font-size: 28rpx;
  color: #222222;
  font-weight: 600;
  margin-bottom: 16rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.now-playing-empty {
  color: #999999;
}
.progress-row {
  display: flex;
  align-items: center;
}
.time {
  font-size: 22rpx;
  color: #999999;
  width: 90rpx;
  flex-shrink: 0;
}
.progress {
  flex: 1;
  margin: 0 12rpx;
}
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8rpx;
}
.ctrl-btn {
  font-size: 56rpx;
  padding: 12rpx 48rpx;
  color: #333333;
}
.ctrl-main {
  font-size: 72rpx;
  padding: 4rpx 40rpx;
}

/* ---------- 轻提示 ---------- */
.toast {
  position: fixed;
  left: 50%;
  bottom: 400rpx;
  transform: translateX(-50%);
  background-color: rgba(0, 0, 0, 0.75);
  color: #ffffff;
  font-size: 26rpx;
  padding: 16rpx 36rpx;
  border-radius: 40rpx;
  z-index: 999;
  max-width: 80%;
}

/* renderjs 承载节点：不可见 */
.renderjs-host {
  display: none;
}
</style>

<script module="silenceAnalyzer" lang="renderjs">
import analyzer from './silence-analyzer.js'
export default analyzer
</script>
