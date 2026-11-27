import { useIsMobile } from '../../app/viewport.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：不显示标题；移动端保留顶栏按钮，桌面保留顶部安全间距。 */
export const SessionView = ({
  session,
  streaming,
}: {
  session: Session
  streaming: boolean
}) => {
  const isMobile = useIsMobile()
  return (
    <div className={styles.view}>
      {isMobile ? <MobileHeader /> : <div className={styles.header} aria-hidden="true" />}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
          </div>
        }
      />
    </div>
  )
}
