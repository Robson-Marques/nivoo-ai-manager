import * as fs from 'node:fs';
import * as readline from 'node:readline';

export interface AssetValidationConfig {
  code: string;
  tickSize: number;
  sessionOpen: string;
  sessionClose: string;
  validation: {
    minPrice: number;
    maxPrice: number;
    priceMustBeTickMultiple: boolean;
    maxBarRangePoints: number;
    requireSessionHours: boolean;
    requiredColumns: string[];
  };
}

export interface DatasetValidationReport {
  asset: string;
  rows: number;
  valid: boolean;
  errors: Array<{ line: number; issue: string }>;
  errorCount: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Valida CSV OHLCV segundo as regras específicas do ativo (WIN e WDO têm regras independentes). */
export async function validateOhlcvCsv(file: string, cfg: AssetValidationConfig, maxErrors = 200): Promise<DatasetValidationReport> {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  const report: DatasetValidationReport = { asset: cfg.code, rows: 0, valid: true, errors: [], errorCount: 0 };
  const v = cfg.validation;
  let header: string[] | null = null;
  let lineNo = 0;
  let prevTs = '';
  const open = minutes(cfg.sessionOpen);
  const close = minutes(cfg.sessionClose);
  const err = (line: number, issue: string) => {
    report.errorCount++;
    if (report.errors.length < maxErrors) report.errors.push({ line, issue });
  };
  for await (const raw of rl) {
    lineNo++;
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/[;,]/).map((c) => c.trim());
    if (!header) {
      header = cols.map((c) => c.toLowerCase());
      const missing = v.requiredColumns.filter((c) => !header!.includes(c));
      if (missing.length) {
        err(lineNo, `colunas obrigatórias ausentes: ${missing.join(', ')}`);
        break;
      }
      continue;
    }
    report.rows++;
    const row = Object.fromEntries(header.map((h, i) => [h, cols[i]]));
    const ts = row.timestamp;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) err(lineNo, `timestamp inválido: ${ts}`);
    if (prevTs && ts <= prevTs) err(lineNo, `timestamp fora de ordem/duplicado: ${ts}`);
    prevTs = ts;
    report.firstTimestamp ??= ts;
    report.lastTimestamp = ts;
    const [o, h, l, c] = ['open', 'high', 'low', 'close'].map((k) => Number(row[k]));
    if ([o, h, l, c].some((x) => !Number.isFinite(x))) {
      err(lineNo, 'preço não numérico');
      continue;
    }
    if (h < Math.max(o, c, l) || l > Math.min(o, c, h)) err(lineNo, 'inconsistência OHLC (high/low)');
    for (const [k, x] of [['open', o], ['high', h], ['low', l], ['close', c]] as const) {
      if (x < v.minPrice || x > v.maxPrice) err(lineNo, `${k}=${x} fora da faixa ${cfg.code} [${v.minPrice}, ${v.maxPrice}]`);
      if (v.priceMustBeTickMultiple) {
        const ratio = x / cfg.tickSize;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-6) err(lineNo, `${k}=${x} não é múltiplo do tick ${cfg.tickSize} (${cfg.code})`);
      }
    }
    if (h - l > v.maxBarRangePoints) err(lineNo, `amplitude ${h - l} > ${v.maxBarRangePoints} pontos (${cfg.code})`);
    const vol = Number(row.volume);
    if (!Number.isFinite(vol) || vol < 0) err(lineNo, `volume inválido: ${row.volume}`);
    if (v.requireSessionHours && !Number.isNaN(d.getTime())) {
      const m = /T?(\d{2}):(\d{2})/.exec(ts.replace(/^\d{4}-\d{2}-\d{2}/, ''));
      if (m) {
        const mm = Number(m[1]) * 60 + Number(m[2]);
        if (mm < open || mm > close) err(lineNo, `horário ${m[1]}:${m[2]} fora do pregão ${cfg.sessionOpen}-${cfg.sessionClose} (${cfg.code})`);
      }
    }
  }
  if (!header) err(0, 'arquivo vazio');
  report.valid = report.errorCount === 0;
  return report;
}
