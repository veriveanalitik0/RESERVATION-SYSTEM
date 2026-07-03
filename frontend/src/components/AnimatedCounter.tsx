/**
 * AnimatedCounter — sayfa açılınca 0'dan target değere animasyonlu sayım.
 *
 * Saf requestAnimationFrame (framer-motion gerektirmez), IntersectionObserver ile
 * viewport'a girdiğinde başlar (Landing hero stats için ideal). easeOutCubic ile
 * doğal yumuşama. tabular-nums ile yer sıçraması olmaz.
 *
 * Kullanım:
 *   <AnimatedCounter end={18} duration={1500} />
 *   <AnimatedCounter end={1500} duration={2000} format={(n) => n.toLocaleString('tr-TR')} />
 */
import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Hedef değer. */
  end: number;
  /** Başlangıç değeri. Default: 0. */
  start?: number;
  /** Animasyon süresi (ms). Default: 1500. */
  duration?: number;
  /** Decimal places (örn: 2). Default: 0. */
  decimals?: number;
  /** Custom formatter. Override decimals. */
  format?: (value: number) => string;
  /** Sayıdan sonra gelecek sabit metin (örn: "+", "%"). */
  suffix?: string;
  /** Sayıdan önce gelecek sabit metin. */
  prefix?: string;
  className?: string;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedCounter({
  end,
  start = 0,
  duration = 1500,
  decimals = 0,
  format,
  suffix,
  prefix,
  className = '',
}: Props) {
  const [value, setValue] = useState(start);
  const elRef = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const begin = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      const startTime = performance.now();
      const tick = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = easeOutCubic(t);
        const current = start + (end - start) * eased;
        setValue(current);
        if (t < 1) requestAnimationFrame(tick);
        else setValue(end);
      };
      requestAnimationFrame(tick);
    };

    // IntersectionObserver — viewport'a girince başlat
    if (typeof IntersectionObserver === 'undefined') {
      begin();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            begin();
            obs.disconnect();
            return;
          }
        }
      },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [end, start, duration]);

  const displayValue = format
    ? format(value)
    : decimals > 0
      ? value.toFixed(decimals)
      : Math.round(value).toString();

  return (
    <span ref={elRef} className={`tabular-nums ${className}`}>
      {prefix}
      {displayValue}
      {suffix}
    </span>
  );
}
