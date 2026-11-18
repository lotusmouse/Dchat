import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：圆形菜单按钮，右侧通话与新对话共用原生按钮组。 */
export const MobileHeader = ({ title }: { title?: string }) => {
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
      {title === undefined ? <div className={styles.titleSpacer} /> : <div className={styles.title}>{title}</div>}
      <div className={styles.actions}>
        <IconButton
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
