/**
 * silence-analyzer.js
 * renderjs 静音分析模块
 *
 * 作用：接收逻辑层传来的 base64 音频数据，用 Web Audio API 解码为 PCM，
 *       分块计算音量（RMS），从文件 80% 位置起寻找"连续3秒低于 -45dB"的
 *       第一处起点，作为 silenceStart 回传给逻辑层。
 *
 * 说明：renderjs 运行在 webview 层，只能做"预分析"，不做实时检测。
 *       分析完成即释放，播放期间零 CPU 占用。
 */

// 静音分析参数（与需求文档 6.3 一致）
const BLOCK_MS = 200        // 检测粒度：每 200ms 一个音量块
const START_RATIO = 0.8     // 分析起始位置：文件 80%（相当于最后 2 分钟）
const THRESHOLD_DB = -45    // 静音阈值：低于 -45dB 视为静音
const SILENT_BLOCKS = 15    // 连续块数：15 块 = 连续 3 秒

export default {
  data() {
    return {
      analyze: null // 逻辑层通过 :analyze prop 传入 { index, base64 }
    }
  },

  mounted() {
    // 页面加载时创建一个 AudioContext 实例，后续复用
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    } catch (e) {
      console.error('[SonicRead] AudioContext 创建失败', e)
      this.audioCtx = null
    }
  },

  watch: {
    // prop 变化即收到新的分析任务
    analyze(val) {
      if (val && val.base64 && this.audioCtx) {
        this.doAnalyze(val)
      }
    }
  },

  methods: {
    /**
     * 执行静音分析
     * @param {{index: number, base64: string}} task 分析任务
     */
    doAnalyze({ index, base64 }) {
      const finish = (silenceStart) => {
        // 回传结果给逻辑层
        this.$ownerInstance.callMethod('onSilenceAnalyzed', {
          index: index,
          silenceStart: silenceStart
        })
      }

      try {
        const bytes = this.base64ToBytes(base64)
        this.decodeAudio(bytes.buffer)
          .then((audioBuffer) => {
            const silenceStart = this.findSilenceStart(audioBuffer)
            finish(silenceStart)
          })
          .catch((err) => {
            console.error('[SonicRead] 音频解码失败', err)
            finish(-1) // 解码失败：-1 表示无静音信息，跳过静音跳转
          })
      } catch (e) {
        console.error('[SonicRead] 静音分析异常', e)
        finish(-1)
      }
    },

    /**
     * base64 字符串 → ArrayBuffer
     */
    base64ToBytes(base64) {
      const binary = atob(base64)
      const len = binary.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    },

    /**
     * 解码音频（兼容 promise 式与回调式 API）
     */
    decodeAudio(arrayBuffer) {
      const ctx = this.audioCtx
      return new Promise((resolve, reject) => {
        // 新版 API 为 promise 式（形参 1 个）；旧版为回调式（形参 3 个）
        if (ctx.decodeAudioData.length > 1) {
          ctx.decodeAudioData(arrayBuffer, resolve, reject)
        } else {
          ctx.decodeAudioData(arrayBuffer).then(resolve).catch(reject)
        }
      })
    },

    /**
     * 从 PCM 数据中寻找尾部静音起点
     * @returns {number} 静音起点秒数；无静音返回 -1
     */
    findSilenceStart(buffer) {
      const sampleRate = buffer.sampleRate
      const channelData = []
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        channelData.push(buffer.getChannelData(c))
      }

      const blockSize = Math.round((sampleRate * BLOCK_MS) / 1000) // 每块采样点数
      const totalBlocks = Math.ceil(buffer.length / blockSize)
      const startBlock = Math.floor(totalBlocks * START_RATIO) // 从 80% 位置开始找

      // 从 startBlock 向后滑窗，检查是否存在连续 SILENT_BLOCKS 块静音
      for (let i = startBlock; i <= totalBlocks - SILENT_BLOCKS; i++) {
        let isSilent = true
        for (let j = 0; j < SILENT_BLOCKS; j++) {
          if (this.blockDb(channelData, i + j, blockSize, buffer.length) > THRESHOLD_DB) {
            isSilent = false
            break
          }
        }
        if (isSilent) {
          // 找到第一处连续静音的起点，换算为秒
          return (i * BLOCK_MS) / 1000
        }
      }
      return -1 // 尾部无静音段
    },

    /**
     * 计算某一块的 RMS 音量并转 dBFS
     */
    blockDb(channelData, blockIndex, blockSize, totalLength) {
      const start = blockIndex * blockSize
      const end = Math.min(start + blockSize, totalLength)
      const n = (end - start) * channelData.length
      if (n <= 0) return -Infinity

      let sum = 0
      for (let c = 0; c < channelData.length; c++) {
        const data = channelData[c]
        for (let k = start; k < end; k++) {
          sum += data[k] * data[k]
        }
      }
      const rms = Math.sqrt(sum / n)
      // dBFS = 20 * log10(rms)，rms 极小值做下限保护，防止 log10(0) 得 -Infinity
      return 20 * Math.log10(Math.max(rms, 1e-7))
    }
  }
}
