import styles from './studio.module.css';

export type IconName = 'arrow' | 'upload' | 'camera' | 'lock' | 'hanger' | 'check' | 'close' | 'info' | 'sun' | 'switch';
const paths: Record<IconName, React.ReactNode> = {
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  upload: <path d="M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5" />,
  camera: <><path d="M4 7h4l2-3h4l2 3h4v13H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
  hanger: <path d="M9.5 6a2.5 2.5 0 1 1 4.3 1.7L12 9v2l9 6v2H3v-2l9-6" />,
  check: <path d="m5 12 4 4L19 6" />, close: <path d="m6 6 12 12M18 6 6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  switch: <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" />,
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`${styles.icon} ${className}`} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
