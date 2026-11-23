import clsx from 'clsx'
import { useMemo } from 'react'
import { readAvatarSrc } from './useEnhanceSetting.js'
import styles from './ChatAvatar.module.css'

/** 消息头像：助手用（可自定义的）应用头像，用户用字母圆片 */
export const ChatAvatar = ({ role }: { role: 'user' | 'assistant' }) => {
  const src = useMemo(() => readAvatarSrc(), [])
  if (role === 'assistant') {
    return <img className={styles.avatar} src={src} alt="" />
  }
  return <span className={clsx(styles.avatar, styles.user)}>我</span>
}
