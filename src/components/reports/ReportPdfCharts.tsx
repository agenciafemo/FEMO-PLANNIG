import { Line, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";

const BRAND = "#1B4B4A";
const ACCENT = "#E19A32";
const MUTED = "#667573";
const BORDER = "#DDE5E4";
const TRACK = "#EDF2F1";

export type ReportPdfChartPoint = {
  label: string;
  value: number;
};

type ChartProps = {
  data: ReportPdfChartPoint[];
  emptyLabel?: string;
};

const styles = StyleSheet.create({
  chart: {
    borderColor: BORDER,
    borderRadius: 9,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  plotRow: { flexDirection: "row" },
  yAxis: {
    height: 122,
    justifyContent: "space-between",
    paddingBottom: 2,
    paddingRight: 8,
    width: 42,
  },
  axisLabel: { color: MUTED, fontSize: 6.5, textAlign: "right" },
  plot: { flexGrow: 1, height: 122 },
  xAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginLeft: 42,
    marginTop: 5,
  },
  xLabel: { color: MUTED, fontSize: 6.5, textAlign: "center", width: 34 },
  bars: {
    alignItems: "flex-end",
    flexDirection: "row",
    height: 122,
    justifyContent: "space-around",
  },
  barColumn: {
    alignItems: "center",
    height: 122,
    justifyContent: "flex-end",
    width: 46,
  },
  barValue: { color: MUTED, fontSize: 6.5, marginBottom: 3 },
  bar: {
    backgroundColor: BRAND,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    minHeight: 2,
    width: 22,
  },
  barLabel: { color: MUTED, fontSize: 6.5, marginTop: 5, textAlign: "center" },
  progressRow: { marginBottom: 9 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  progressLabel: { color: "#17201F", fontSize: 8 },
  progressValue: { color: MUTED, fontSize: 8 },
  progressTrack: {
    backgroundColor: TRACK,
    borderRadius: 3,
    height: 6,
    overflow: "hidden",
  },
  progressFill: { backgroundColor: ACCENT, borderRadius: 3, height: 6 },
  empty: { color: MUTED, fontSize: 8, paddingVertical: 30, textAlign: "center" },
});

function compactNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function normalizedData(data: ReportPdfChartPoint[]): ReportPdfChartPoint[] {
  return data.filter((item) => Number.isFinite(item.value));
}

function sampledLabels(data: ReportPdfChartPoint[]): ReportPdfChartPoint[] {
  if (data.length <= 5) return data;
  const indices = new Set([
    0,
    Math.round((data.length - 1) * 0.25),
    Math.round((data.length - 1) * 0.5),
    Math.round((data.length - 1) * 0.75),
    data.length - 1,
  ]);
  return [...indices].map((index) => data[index]);
}

export function ReportPdfLineChart({ data, emptyLabel = "Dados indisponíveis" }: ChartProps) {
  const points = normalizedData(data);
  if (points.length === 0) return <Text style={styles.empty}>{emptyLabel}</Text>;

  const width = 460;
  const height = 118;
  const top = 8;
  const bottom = 10;
  const max = Math.max(1, ...points.map((item) => item.value));
  const coordinates = points.map((item, index) => ({
    x: points.length === 1 ? width / 2 : (index / (points.length - 1)) * width,
    y: top + (1 - item.value / max) * (height - top - bottom),
  }));
  const path = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const labels = sampledLabels(points);

  return (
    <View style={styles.chart} wrap={false}>
      <View style={styles.plotRow}>
        <View style={styles.yAxis}>
          <Text style={styles.axisLabel}>{compactNumber(max)}</Text>
          <Text style={styles.axisLabel}>{compactNumber(max / 2)}</Text>
          <Text style={styles.axisLabel}>0</Text>
        </View>
        <Svg viewBox={`0 0 ${width} ${height}`} style={styles.plot}>
          <Line x1="0" y1={top} x2={width} y2={top} stroke={BORDER} strokeWidth="1" />
          <Line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={BORDER} strokeWidth="1" />
          <Line x1="0" y1={height - bottom} x2={width} y2={height - bottom} stroke={BORDER} strokeWidth="1" />
          {points.length > 1 ? (
            <Path d={path} fill="none" stroke={BRAND} strokeWidth="2.4" />
          ) : (
            <Line x1={width / 2 - 1} y1={coordinates[0].y} x2={width / 2 + 1} y2={coordinates[0].y} stroke={BRAND} strokeWidth="5" />
          )}
        </Svg>
      </View>
      <View style={styles.xAxis}>
        {labels.map((item, index) => (
          <Text key={`${item.label}-${index}`} style={styles.xLabel}>{item.label}</Text>
        ))}
      </View>
    </View>
  );
}

export function ReportPdfBarChart({ data, emptyLabel = "Dados indisponíveis" }: ChartProps) {
  const points = normalizedData(data).slice(0, 10);
  if (points.length === 0) return <Text style={styles.empty}>{emptyLabel}</Text>;

  const max = Math.max(1, ...points.map((item) => item.value));
  return (
    <View style={styles.chart} wrap={false}>
      <View style={styles.bars}>
        {points.map((item, index) => (
          <View key={`${item.label}-${index}`} style={styles.barColumn}>
            <Text style={styles.barValue}>{compactNumber(item.value)}</Text>
            <View style={[styles.bar, { height: Math.max(2, (item.value / max) * 92) }]} />
            <Text style={styles.barLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ReportPdfProgressChart({ data, emptyLabel = "Dados indisponíveis" }: ChartProps) {
  const points = normalizedData(data).slice(0, 8);
  if (points.length === 0) return <Text style={styles.empty}>{emptyLabel}</Text>;

  const max = Math.max(1, ...points.map((item) => item.value));
  return (
    <View style={styles.chart} wrap={false}>
      {points.map((item, index) => (
        <View key={`${item.label}-${index}`} style={styles.progressRow}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>{item.label}</Text>
            <Text style={styles.progressValue}>{item.value.toLocaleString("pt-BR")}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(1, (item.value / max) * 100)}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}
