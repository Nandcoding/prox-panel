/**
 * prox controls for the pool cards: what the chart plots, the burn lookback,
 * how future usage compares to now, per-account lines and the two-week range.
 */

import { useTranslation } from 'react-i18next';
import { IconChevronLeft } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { DAY_MS } from '@/utils/time/durations';
import { resolveLocale } from '../display';
import {
  PROX_BURN_HOURS,
  PROX_FUTURE_USAGE,
  type ProxBurnHours,
  type ProxChartMode,
  type ProxFutureUsage,
} from './ProxPoolPanel';
import styles from './ProxQuotaControls.module.scss';

export interface ProxQuotaControlsProps {
  chartMode: ProxChartMode;
  burnHours: ProxBurnHours;
  futureUsage: ProxFutureUsage;
  showAccounts: boolean;
  rangeStartMs: number;
  rangeEndMs: number;
  isToday: boolean;
  onChartModeChange: (mode: ProxChartMode) => void;
  onBurnHoursChange: (hours: ProxBurnHours) => void;
  onFutureUsageChange: (usage: ProxFutureUsage) => void;
  onShowAccountsChange: (show: boolean) => void;
  onShiftRange: (direction: -1 | 1) => void;
  onToday: () => void;
}

export function ProxQuotaControls(props: ProxQuotaControlsProps) {
  const {
    chartMode,
    burnHours,
    futureUsage,
    showAccounts,
    rangeStartMs,
    rangeEndMs,
    isToday,
    onChartModeChange,
    onBurnHoursChange,
    onFutureUsageChange,
    onShowAccountsChange,
    onShiftRange,
    onToday,
  } = props;
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  return (
    <div className={styles.controls}>
      <div className={styles.segmented} role="group" aria-label={t('prox.chart_label')}>
        {(['remaining', 'drain'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={chartMode === mode}
            className={chartMode === mode ? styles.active : undefined}
            onClick={() => onChartModeChange(mode)}
          >
            {t(`prox.mode_${mode}`)}
          </button>
        ))}
      </div>

      <div className={styles.labelled}>
        <span className={styles.label}>{t('prox.burn_rate')}</span>
        <div className={styles.segmented} role="group" aria-label={t('prox.burn_rate')}>
          {PROX_BURN_HOURS.map((hours) => (
            <button
              key={hours}
              type="button"
              aria-pressed={burnHours === hours}
              className={burnHours === hours ? styles.active : undefined}
              onClick={() => onBurnHoursChange(hours)}
            >
              {t('prox.hours_short', { hours })}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.labelled}>
        <span className={styles.label}>{t('prox.future_usage')}</span>
        <Select
          value={futureUsage}
          options={PROX_FUTURE_USAGE.map((usage) => ({
            value: usage,
            label: t(`prox.future_${usage}`),
          }))}
          onChange={(value) => onFutureUsageChange(value as ProxFutureUsage)}
          ariaLabel={t('prox.future_usage')}
          className={styles.select}
          fullWidth={false}
          size="sm"
        />
      </div>

      <button
        type="button"
        className={`${styles.pill} ${showAccounts ? styles.pillActive : ''}`}
        aria-pressed={showAccounts}
        onClick={() => onShowAccountsChange(!showAccounts)}
      >
        {t('prox.accounts_toggle')}
      </button>

      <div className={styles.range}>
        <span className={styles.rangeText}>
          {t('prox.range', { from: day(rangeStartMs), to: day(rangeEndMs - DAY_MS) })}
        </span>
        <button
          type="button"
          className={styles.arrow}
          aria-label={t('prox.previous_range')}
          onClick={() => onShiftRange(-1)}
        >
          <IconChevronLeft size={16} />
        </button>
        <button
          type="button"
          className={`${styles.pill} ${isToday ? styles.pillActive : ''}`}
          onClick={onToday}
        >
          {t('prox.today')}
        </button>
        <button
          type="button"
          className={`${styles.arrow} ${styles.arrowNext}`}
          aria-label={t('prox.next_range')}
          onClick={() => onShiftRange(1)}
        >
          <IconChevronLeft size={16} />
        </button>
      </div>
    </div>
  );
}
