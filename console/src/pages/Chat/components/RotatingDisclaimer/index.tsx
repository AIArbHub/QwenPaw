import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";

const ROTATION_INTERVAL = 3000; // 3 seconds per slogan

const DISCLAIMER_KEYS = [
  "chat.disclaimer1",
  "chat.disclaimer2",
  "chat.disclaimer3",
  "chat.disclaimer4",
] as const;

/**
 * Renders a rotating disclaimer below the chat input box.
 * Cycles through slogans every 3 seconds with a fade transition.
 */
export default function RotatingDisclaimer() {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setIndex((prev) => (prev + 1) % DISCLAIMER_KEYS.length);
    }, ROTATION_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const currentText = t(DISCLAIMER_KEYS[index]);

  return (
    <div className={styles.rotatingDisclaimer}>
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
          className={styles.slogan}
        >
          {currentText}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
