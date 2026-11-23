import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { readAvatarSrc, readUserAvatarSrc } from './useEnhanceSetting.js'
import styles from './ChatAvatar.module.css'

/** 消息头像：助手用可自定义的头像，用户用自己上传的头像（没设置时显示“我”） */
export const ChatAvatar = ({ role }: { role: 'user' | 'assistant' }) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1)
    window.addEventListener('dshx:avatar', refresh)
    return () => window.removeEventListener('dshx:avatar', refresh)
  }, [])
  void tick

  if (role === 'assistant') {
    return <img className={styles.avatar} src={readAvatarSrc()} alt="" />
  }
  const mine = readUserAvatarSrc()
  if (mine) {
    return <img className={styles.avatar} src={mine} alt="" />
  }
  return <span className={clsx(styles.avatar, styles.user)}>我</span>
}
