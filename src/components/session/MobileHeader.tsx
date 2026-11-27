import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：不显示标题，只保留菜单以及右侧通话、新对话按钮。 */
export const MobileHeader = () => {
  const t = useTranslate()
  return (
    <div className={styles.header}>
      <IconButton
        className={styles.menuButton}
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      <div className={styles.titleSpacer} />
      <div className={styles.actions}>
        <IconButton
          className={styles.actionButton}
          size="xl"
          tone="primary"
          icon={<IconNewChatOutline20 />}
          aria-label={t('newChat')}
          onClick={newChat}
        />
      </div>
    </div>
  )
}
