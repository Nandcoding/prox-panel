/**
 * prox pool card: one provider's pooled weekly quota over a two-week range.
 *
 * Header: pooled remaining ("555% of 600%") and four facts (pool empty, first
 * account empty, next reset, burn over the chosen lookback). Chart: recorded
 * pool (solid) up to now, projected pool (dashed) after it, each reset jump
 * labelled with what it gives back. The projection burns at the measured rate
 * of the chosen lookback, scaled by the "future usage" choice.
 */

import {
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { getTypeLabel } from '@/features/authFiles/constants';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { FORECAST_ACCENTS } from '../constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import {
  aggregateHistory,
  currentDrain,
  drainSeries,
  measureDrain,
  projectQuota,
  type ChartPoint,
  type LiveReading,
} from '../forecast/forecastModel';
import { burnOutcome } from '../forecast/burnRate';
import type { QuotaSnapshot } from '../forecast/quotaHistory';
import {
  meterForWindow,
  resolveMeterRate,
  snapshotsForWindow,
  windowMeasurement,
} from '../forecast/forecastWindows';
import type { SnapshotsFor } from '../hooks/useQuotaHistory';
import { meterAsOf, readQuotaMeters } from '../forecast/quotaMeters';
import {
  formatCompactDuration,
  formatPercent,
  formatRate,
  formatWeekdayTime,
  resolveLocale,
  stripCredentialExtension,
} from '../display';
import { ProviderIcon } from './ProviderIcon';
import { PrivateValue } from './PrivateValue';
import { useWidth } from './useWidth';
import styles from './ProxPoolPanel.module.scss';

export type ProxChartMode = 'remaining' | 'drain';
export const PROX_BURN_HOURS = [1, 3, 6] as const;
export type ProxBurnHours = (typeof PROX_BURN_HOURS)[number];
export const PROX_FUTURE_USAGE = ['same', 'lighter', 'heavier', 'double', 'idle'] as const;
export type ProxFutureUsage = (typeof PROX_FUTURE_USAGE)[number];
const FUTURE_FACTOR: Record<ProxFutureUsage, number> = {
  same: 1,
  lighter: 0.5,
  heavier: 1.5,
  double: 2,
  idle: 0,
};

export interface ProxPoolPanelProps {
  provider: QuotaProviderType;
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  /** This provider's recorded snapshots (all windows). */
  history: QuotaSnapshot[];
  snapshotsFor: SnapshotsFor;
  nowMs: number;
  resolvedTheme: ResolvedTheme;
  chartMode: ProxChartMode;
  burnHours: ProxBurnHours;
  futureUsage: ProxFutureUsage;
  showAccounts: boolean;
  rangeStartMs: number;
  rangeEndMs: number;
}

const CHART_HEIGHT = 330;
const PAD = { top: 34, right: 12, bottom: 30, left: 56 };
/** A recorded rise this big between two readings is a reset, labelled like the projected ones. */
const RECORDED_RESET_MIN = 5;

interface Jump {
  t: number;
  v: number;
  gain: number;
}

/** Where the pool steps up: projected resets, and recorded rises big enough to be one. */
function jumpsIn(points: ChartPoint[]): Jump[] {
  const jumps: Jump[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const gain = points[index].v - points[index - 1].v;
    if (gain >= RECORDED_RESET_MIN) {
      jumps.push({ t: points[index].t, v: points[index].v, gain });
    }
  }
  return jumps;
}

/** Last point at or before `t` in a sorted series. */
function valueAt(points: ChartPoint[], t: number): number | null {
  if (points.length === 0 || t < points[0].t || t > points[points.length - 1].t) return null;
  let value = points[0].v;
  for (const point of points) {
    if (point.t > t) break;
    value = point.v;
  }
  return value;
}

/** Local midnights inside the range, one tick per day. */
function dayTicks(startMs: number, endMs: number): number[] {
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < startMs) cursor.setDate(cursor.getDate() + 1);
  const ticks: number[] = [];
  while (cursor.getTime() < endMs) {
    ticks.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return ticks;
}

export function ProxPoolPanel(props: ProxPoolPanelProps) {
  const {
    provider,
    entries,
    quotaFor,
    history,
    snapshotsFor,
    nowMs,
    resolvedTheme,
    chartMode,
    burnHours,
    futureUsage,
    showAccounts,
    rangeStartMs,
    rangeEndMs,
  } = props;
  const { t, i18n } = useTranslation();
  const accent = FORECAST_ACCENTS[provider];
  const { ref, width } = useWidth();
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const model = useMemo(() => {
    const lookbackMs = burnHours * HOUR_MS;
    const windowHistory = snapshotsForWindow(history, 'weekly');
    const live = entries
      .map((entry): LiveReading | null => {
        const meter = meterForWindow(
          readQuotaMeters(entry.type, quotaFor(entry)).map((item) => meterAsOf(item, nowMs)),
          'weekly'
        );
        if (!meter) return null;
        const credentialId = getQuotaCacheKey(entry.file);
        const rate = resolveMeterRate(
          meter,
          snapshotsFor(credentialId, meter.id),
          nowMs,
          lookbackMs
        );
        return {
          credentialId,
          remaining: meter.remaining,
          resetAtMs: meter.resetAtMs,
          periodHours: meter.periodHours,
          ratePerHour: rate.ratePerHour,
          averagePerHour: rate.averagePerHour,
        };
      })
      .filter((reading): reading is LiveReading => reading !== null);

    const rule = windowMeasurement('weekly', lookbackMs);
    const drain = currentDrain(live, windowHistory, nowMs, rule.lookbackMs, rule.enoughMs);
    // "Burn, last 3h": measured over exactly the chosen lookback when the
    // recorded readings cover it, else the accounts' own window pace.
    const measured = measureDrain(windowHistory, nowMs - lookbackMs, nowMs, lookbackMs / 2);
    const burn = measured?.ratePerHour ?? drain.ratePerHour;
    const projectedRate = burn * FUTURE_FACTOR[futureUsage];
    const untilMs = Math.max(rangeEndMs, nowMs);
    const { points, resets } = projectQuota(live, projectedRate, nowMs, untilMs);

    // Per account at its share of the projected pace: who empties first.
    const shareTotal = live.reduce((total, reading) => total + (reading.ratePerHour ?? 0), 0);
    let firstEmpty: { credentialId: string; atMs: number } | null = null;
    live.forEach((reading) => {
      if (reading.resetAtMs === null || reading.resetAtMs <= nowMs || reading.remaining <= 0) {
        return;
      }
      const share =
        shareTotal > 0 ? (reading.ratePerHour ?? 0) / shareTotal : 1 / Math.max(1, live.length);
      const outcome = burnOutcome(reading.remaining, reading.resetAtMs, projectedRate * share, nowMs);
      if (outcome.runsOutAtMs !== null && (!firstEmpty || outcome.runsOutAtMs < firstEmpty.atMs)) {
        firstEmpty = { credentialId: reading.credentialId, atMs: outcome.runsOutAtMs };
      }
    });

    const accounts = showAccounts
      ? live.map((reading) => {
          const share =
            shareTotal > 0
              ? (reading.ratePerHour ?? 0) / shareTotal
              : 1 / Math.max(1, live.length);
          return {
            credentialId: reading.credentialId,
            recorded: aggregateHistory(
              windowHistory.filter(
                (snapshot) =>
                  snapshot.credentialId === reading.credentialId && snapshot.ts <= nowMs
              )
            ),
            projected: projectQuota([{ ...reading }], projectedRate * share, nowMs, untilMs)
              .points,
          };
        })
      : [];

    return {
      live,
      capacity: live.length * 100,
      remaining: live.reduce((total, reading) => total + reading.remaining, 0),
      recorded: aggregateHistory(windowHistory.filter((snapshot) => snapshot.ts <= nowMs)),
      projection: points,
      nextReset: resets.find((event) => event.gain > 0.5) ?? null,
      poolEmptyAtMs: points.find((point) => point.t > nowMs && point.v < 0.5)?.t ?? null,
      firstEmpty: firstEmpty as { credentialId: string; atMs: number } | null,
      burn,
      projectedRate,
      drainPast: drainSeries(windowHistory, nowMs, Math.max(HOUR_MS, nowMs - rangeStartMs)),
      accounts,
    };
  }, [
    burnHours,
    entries,
    futureUsage,
    history,
    nowMs,
    quotaFor,
    rangeEndMs,
    rangeStartMs,
    showAccounts,
    snapshotsFor,
  ]);

  const providerName = getTypeLabel(t, provider);
  const locale = resolveLocale(i18n.language);
  const shortDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  if (model.live.length === 0) {
    return (
      <section className={`${styles.panel} ${styles.panelEmpty}`}>
        <span className={styles.provider}>
          <ProviderIcon provider={provider} resolvedTheme={resolvedTheme} size="sm" />
          <span className={styles.providerName}>{providerName}</span>
        </span>
        <p className={styles.empty}>{t('prox.no_weekly')}</p>
      </section>
    );
  }

  const drainMode = chartMode === 'drain';
  const drainValues = model.drainPast.segments.flat().map((point) => point.v);
  const yMax = drainMode
    ? Math.max(1, Math.ceil(Math.max(model.projectedRate, model.burn, ...drainValues) * 1.25))
    : Math.max(model.capacity, 100);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const span = rangeEndMs - rangeStartMs;
  const x = (ms: number) => PAD.left + ((ms - rangeStartMs) / span) * plotWidth;
  const y = (value: number) =>
    PAD.top + plotHeight - (Math.max(0, Math.min(value, yMax)) / yMax) * plotHeight;
  const baseline = y(0);
  const clip = (points: ChartPoint[]) =>
    points.filter((point) => point.t >= rangeStartMs && point.t <= rangeEndMs);
  const linePath = (points: ChartPoint[]) =>
    points.map((point, index) => `${index ? 'L' : 'M'}${x(point.t)},${y(point.v)}`).join('');
  const areaPath = (points: ChartPoint[]) =>
    points.length < 2
      ? ''
      : `${linePath(points)}L${x(points[points.length - 1].t)},${baseline}L${x(points[0].t)},${baseline}Z`;

  const recorded = (drainMode ? model.drainPast.segments : model.recorded)
    .map(clip)
    .filter((segment) => segment.length > 0);
  const projected = drainMode
    ? clip([
        { t: nowMs, v: model.projectedRate },
        { t: rangeEndMs, v: model.projectedRate },
      ])
    : clip(model.projection);
  const jumps = drainMode
    ? []
    : [...recorded.flatMap(jumpsIn), ...jumpsIn(projected)].filter(
        (jump) => jump.t > rangeStartMs && jump.t < rangeEndMs
      );
  const nowVisible = nowMs >= rangeStartMs && nowMs <= rangeEndMs;
  const nowValue = drainMode ? model.burn : model.remaining;
  const format = drainMode ? (value: number) => `${formatRate(value)}/h` : formatPercent;
  const yTicks = [0, 0.5, 1].map((fraction) => fraction * yMax);

  const hoverRecorded =
    hoverMs !== null && hoverMs <= nowMs
      ? (recorded.map((segment) => valueAt(segment, hoverMs)).find((v) => v !== null) ?? null)
      : null;
  const hoverProjected =
    hoverMs !== null && hoverMs > nowMs ? valueAt(projected, hoverMs) : null;
  const hoverValue = hoverRecorded ?? hoverProjected;
  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    if (px < PAD.left || px > width - PAD.right) return setHoverMs(null);
    setHoverMs(rangeStartMs + ((px - PAD.left) / plotWidth) * span);
  };

  const facts: { label: string; value: ReactNode }[] = [
    {
      label: t('prox.pool_empty'),
      value:
        model.poolEmptyAtMs !== null
          ? formatWeekdayTime(model.poolEmptyAtMs, i18n.language)
          : t('prox.not_by', { date: shortDate(rangeEndMs) }),
    },
    {
      label: t('prox.first_empty'),
      value: model.firstEmpty ? (
        <span className={styles.firstEmpty}>
          <PrivateValue
            value={stripCredentialExtension(model.firstEmpty.credentialId)}
            className={styles.accountName}
          />
          {t('prox.in_duration', { duration: formatCompactDuration(model.firstEmpty.atMs - nowMs) })}
        </span>
      ) : (
        t('prox.none_in_range')
      ),
    },
    {
      label: t('prox.next_reset'),
      value: model.nextReset
        ? `+${formatPercent(model.nextReset.gain)} ${formatWeekdayTime(model.nextReset.atMs, i18n.language)}`
        : '—',
    },
    {
      label: t('prox.burn_last', { hours: burnHours }),
      value: `${formatRate(model.burn)}/h`,
    },
  ];

  const readoutLeft = hoverMs === null ? 0 : x(hoverMs);

  return (
    <section
      className={styles.panel}
      style={{ '--prox-accent': accent } as CSSProperties}
      aria-label={`${t('quota_management.forecast_title')} · ${providerName}`}
    >
      <div className={styles.titleRow}>
        <ProviderIcon provider={provider} resolvedTheme={resolvedTheme} size="sm" />
        <span className={styles.providerName}>{providerName}</span>
        <span className={styles.accounts}>
          {t('prox.accounts', { count: model.live.length })}
        </span>
      </div>

      <div className={styles.summary}>
        <p className={styles.totals}>
          <span className={styles.bigNumber}>{formatPercent(model.remaining)}</span>
          <span className={styles.capacity}>
            {t('prox.of_capacity', { capacity: formatPercent(model.capacity) })}
          </span>
        </p>
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div ref={ref} className={styles.chart} style={{ height: CHART_HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={CHART_HEIGHT}
            role="img"
            aria-label={t(drainMode ? 'prox.mode_drain' : 'prox.mode_remaining')}
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverMs(null)}
          >
            <defs>
              <linearGradient id={`prox-fill-${provider}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
                <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {yTicks.map((value) => (
              <g key={value}>
                <line
                  className={value === 0 ? styles.baseLine : styles.gridLine}
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(value)}
                  y2={y(value)}
                />
                <text
                  className={styles.axisLabel}
                  x={PAD.left - 12}
                  y={y(value)}
                  textAnchor="end"
                  dy="0.35em"
                >
                  {format(value)}
                </text>
              </g>
            ))}
            {dayTicks(rangeStartMs, rangeEndMs).map((ms) => (
              <g key={ms}>
                <line
                  className={styles.dayLine}
                  x1={x(ms)}
                  x2={x(ms)}
                  y1={PAD.top}
                  y2={baseline}
                />
                <text
                  className={styles.axisLabel}
                  x={x(ms + DAY_MS / 2)}
                  y={CHART_HEIGHT - 8}
                  textAnchor="middle"
                >
                  {new Date(ms).toLocaleDateString(locale, { weekday: 'short' })}{' '}
                  {new Date(ms).getDate()}
                </text>
              </g>
            ))}

            {showAccounts &&
              !drainMode &&
              model.accounts.map((account) => (
                <g key={account.credentialId} className={styles.accountLines}>
                  {account.recorded.map(clip).map((segment) => (
                    <path key={segment[0]?.t ?? 0} d={linePath(segment)} />
                  ))}
                  <path d={linePath(clip(account.projected))} className={styles.accountProjected} />
                </g>
              ))}

            {recorded.map((segment) =>
              segment.length === 1 ? (
                <circle
                  key={segment[0].t}
                  cx={x(segment[0].t)}
                  cy={y(segment[0].v)}
                  r={3}
                  fill={accent}
                />
              ) : (
                <g key={segment[0]?.t ?? 0}>
                  <path d={areaPath(segment)} fill={`url(#prox-fill-${provider})`} />
                  <path d={linePath(segment)} className={styles.recordedLine} />
                </g>
              )
            )}
            {projected.length > 1 && (
              <>
                <path
                  d={areaPath(projected)}
                  fill={`url(#prox-fill-${provider})`}
                  opacity={0.55}
                />
                <path d={linePath(projected)} className={styles.projectedLine} />
              </>
            )}

            {jumps.map((jump) => (
              <text
                key={`${jump.t}-${jump.gain}`}
                className={styles.jumpLabel}
                x={x(jump.t)}
                y={y(jump.v) - 9}
                textAnchor="middle"
              >
                +{formatPercent(jump.gain)}
              </text>
            ))}

            {nowVisible && (
              <g>
                <line className={styles.nowLine} x1={x(nowMs)} x2={x(nowMs)} y1={PAD.top - 8} y2={baseline} />
                <text className={styles.nowLabel} x={x(nowMs)} y={PAD.top - 14} textAnchor="middle">
                  {t('quota_management.forecast_now')}
                </text>
                <circle className={styles.nowDot} cx={x(nowMs)} cy={y(nowValue)} r={4} />
              </g>
            )}

            {hoverMs !== null && hoverValue !== null && (
              <g pointerEvents="none">
                <line className={styles.hoverLine} x1={readoutLeft} x2={readoutLeft} y1={PAD.top} y2={baseline} />
                <circle
                  className={styles.hoverDot}
                  cx={readoutLeft}
                  cy={y(hoverValue)}
                  r={4.5}
                />
              </g>
            )}
          </svg>
        )}
        {hoverMs !== null && hoverValue !== null && (
          <div className={styles.readout}>
            {formatWeekdayTime(hoverMs, i18n.language)} ·{' '}
            {drainMode
              ? `${formatRate(hoverValue)}/h`
              : t('prox.left', { value: formatPercent(hoverValue) })}{' '}
            · {t(hoverMs <= nowMs ? 'prox.recorded' : 'prox.projected').toLowerCase()}
          </div>
        )}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendTitle}>{t('prox.pool')}</span>
        <span className={styles.legendItem}>
          <span className={styles.legendSolid} />
          {t('prox.recorded')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDashed} />
          {t('prox.projected')}
        </span>
      </div>
    </section>
  );
}
