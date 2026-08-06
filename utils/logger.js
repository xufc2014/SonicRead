/**
 * logger.js - 简易运行日志系统（App 逻辑层）
 *
 * 用途：排查后台播放问题。所有关键事件写入公共目录日志文件，
 *       息屏后通过日志中的心跳/进度记录判断 JS 逻辑层是否存活。
 *
 * 日志位置：/storage/emulated/0/Download/sonicread.log
 *           （手机文件管理器可直接查看；APP 内也有查看面板）
 * 实现：plus.android 反射 java.io（与项目其他文件操作一致，绕开 plus.io 路径限制）
 */

const LOG_PATH = '/storage/emulated/0/Download/sonicread.log'
const MAX_SIZE = 512 * 1024 // 日志超过 512KB 自动清空重写

// 当前时间，格式 YYYY-MM-DD HH:mm:ss.mmm（含毫秒，便于判断时序）
function now() {
  const d = new Date()
  const p = (n) => (n < 10 ? '0' + n : n)
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) +
    '.' + String(d.getMilliseconds()).padStart(3, '0')
  )
}

/**
 * 追加一行日志（带时间戳）
 * 写入失败静默处理，绝不影响主流程
 */
export function log(msg) {
  // #ifdef APP-PLUS
  try {
    const File = plus.android.importClass('java.io.File')
    const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')
    const StringCls = plus.android.importClass('java.lang.String')

    const file = new File(LOG_PATH)
    // 超限自动清空，防止日志无限膨胀
    if (file.exists() && file.length() > MAX_SIZE) {
      file.delete()
    }
    const fos = new FileOutputStream(file, true) // true = 追加模式
    const s = new StringCls(now() + ' ' + msg + '\n')
    const bytes = s.getBytes('UTF-8') // Java byte[] → JS 数字数组
    fos.write(bytes)
    fos.close()
  } catch (e) {
    // 忽略：日志失败不影响功能
  }
  // #endif
}

/**
 * 读取日志内容（返回最后 maxLines 行）
 * @param {number} maxLines 最大行数，默认 300
 * @returns {string}
 */
export function readLog(maxLines = 300) {
  // #ifdef APP-PLUS
  try {
    const File = plus.android.importClass('java.io.File')
    const FileInputStream = plus.android.importClass('java.io.FileInputStream')
    const ByteArrayOutputStream = plus.android.importClass('java.io.ByteArrayOutputStream')
    const StringCls = plus.android.importClass('java.lang.String')

    const file = new File(LOG_PATH)
    if (!file.exists()) return '（暂无日志，请先在 APP 中播放一下再查看）'

    const fis = new FileInputStream(file)
    const bos = new ByteArrayOutputStream()
    const buffer = plus.android.newObject('[B', 8192)
    let len = fis.read(buffer)
    while (len > 0) {
      bos.write(buffer, 0, len)
      len = fis.read(buffer)
    }
    fis.close()
    const bytes = bos.toByteArray()
    const text = new StringCls(bytes, 'UTF-8') // Java String → JS 字符串
    const lines = String(text).split('\n')
    return lines.slice(-maxLines).join('\n')
  } catch (e) {
    return '（读取日志失败：' + e.message + '）'
  }
  // #endif
  // #ifndef APP-PLUS
  return '（仅 App 端支持日志）'
  // #endif
}

/**
 * 清空日志文件
 */
export function clearLog() {
  // #ifdef APP-PLUS
  try {
    const File = plus.android.importClass('java.io.File')
    const file = new File(LOG_PATH)
    if (file.exists()) {
      file.delete()
    }
  } catch (e) {
    // 忽略
  }
  // #endif
}
