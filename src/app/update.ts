const CHECK_INTERVAL = 15000

let lastCheck = 0
let checking = false
let reloading = false

const isNewerVersion = (candidate: string, current: string) => {
  const left = candidate.split('.').map(Number)
  const right = current.split('.').map(Number)
  if (!left.length || !right.length || [...left, ...right].some((part) => !Number.isFinite(part))) {
    return false
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) {
      return difference > 0
    }
  }
  return false
}

/** PWA 恢复前台时可能仍展示冻结前的文档，主动检查入口版本而不是依赖浏览器刷新。 */
const checkForUpdate = async (force = false) => {
  if (
    checking ||
    reloading ||
    !['http:', 'https:'].includes(window.location.protocol) ||
    (!force && Date.now() - lastCheck < CHECK_INTERVAL)
  ) {
    return
  }
  checking = true
  lastCheck = Date.now()
  try {
    const url = new URL('index.html', window.location.href)
    url.searchParams.set('dchat-update', String(lastCheck))
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    })
    if (!response.ok) {
      return
    }
    const documentVersion = (root: Document) =>
      root.querySelector('meta[name="application-version"]')?.getAttribute('content')?.trim() ?? ''
    const remoteDocument = new DOMParser().parseFromString(await response.text(), 'text/html')
    const remoteVersion = documentVersion(remoteDocument)
    const currentVersion = documentVersion(document)
    if (remoteVersion && currentVersion && isNewerVersion(remoteVersion, currentVersion)) {
      reloading = true
      window.location.reload()
    }
  } catch {
    // 离线或网络失败不影响当前页面，下次恢复前台时再检查。
  } finally {
    checking = false
  }
}

export const setupAppUpdates = () => {
  // pageshow 同时覆盖首次启动和浏览器从 bfcache 恢复安装版页面的情况。
  window.addEventListener('pageshow', () => void checkForUpdate(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForUpdate()
    }
  })
}
