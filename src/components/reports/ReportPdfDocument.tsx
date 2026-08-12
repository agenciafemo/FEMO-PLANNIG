import {
  Document,
  Image,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { MediaItem, MetaInsights } from "@/lib/reportRpc";

import {
  ReportPdfBarChart,
  ReportPdfLineChart,
  ReportPdfProgressChart,
  type ReportPdfChartPoint,
} from "./ReportPdfCharts";

const BRAND = "#1B4B4A";
const BRAND_SOFT = "#E8F1F0";
const INK = "#17201F";
const MUTED = "#667573";
const BORDER = "#DDE5E4";
const POSITIVE = "#167A5A";
const NEGATIVE = "#B42318";
const PAPER = "#FFFFFF";

export type ReportPdfPeriod = {
  from: string;
  to: string;
  compareFrom?: string;
  compareTo?: string;
};

export type ReportPdfClient = {
  name: string;
  logoUrl?: string | null;
};

export type ReportPdfDeltas = Partial<{
  followers: number | null;
  reach: number | null;
  engagement: number | null;
  newFollowers: number | null;
}>;

export type ReportPdfDocumentProps = {
  client: ReportPdfClient;
  period: ReportPdfPeriod;
  insights: MetaInsights;
  deltas?: ReportPdfDeltas;
  generatedAt?: Date;
  norteiaLogoUrl?: string;
};

type MetricDefinition = {
  label: string;
  value: number | null;
  delta?: number | null;
  note?: string;
};

function assetUrl(path: string): string {
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? "Dados indisponíveis" : value.toLocaleString("pt-BR");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatGeneratedAt(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(value);
}

function formatDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function pctDelta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function engagementOf(media: MediaItem): number {
  return (media.like_count ?? 0) + (media.comments_count ?? 0);
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAPER,
    color: INK,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    paddingBottom: 54,
    paddingHorizontal: 38,
    paddingTop: 42,
  },
  cover: {
    backgroundColor: PAPER,
    color: INK,
    fontFamily: "Helvetica",
    padding: 48,
  },
  coverBand: {
    backgroundColor: BRAND,
    height: 18,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  coverEyebrow: {
    color: BRAND,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1.5,
    marginBottom: 18,
    textTransform: "uppercase",
  },
  coverContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  clientIdentity: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 30,
  },
  clientLogo: {
    borderRadius: 12,
    height: 72,
    objectFit: "contain",
    width: 72,
  },
  clientFallback: {
    alignItems: "center",
    backgroundColor: BRAND_SOFT,
    borderRadius: 12,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  clientInitial: {
    color: BRAND,
    fontSize: 28,
    fontWeight: 700,
  },
  clientName: {
    color: INK,
    fontSize: 20,
    fontWeight: 700,
    marginLeft: 18,
    maxWidth: 360,
  },
  coverTitle: {
    color: INK,
    fontSize: 36,
    fontWeight: 700,
    letterSpacing: -0.8,
    lineHeight: 1.08,
    marginBottom: 14,
    maxWidth: 430,
  },
  coverSubtitle: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 1.5,
    marginBottom: 34,
    maxWidth: 420,
  },
  periodBox: {
    backgroundColor: BRAND_SOFT,
    borderRadius: 10,
    flexDirection: "row",
    padding: 18,
  },
  periodColumn: {
    flexGrow: 1,
  },
  periodDivider: {
    backgroundColor: "#C9DAD8",
    marginHorizontal: 18,
    width: 1,
  },
  periodLabel: {
    color: MUTED,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  periodValue: {
    color: BRAND,
    fontSize: 10.5,
    fontWeight: 700,
    lineHeight: 1.4,
  },
  coverFooter: {
    alignItems: "flex-end",
    borderTopColor: BORDER,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 16,
  },
  generated: {
    color: MUTED,
    fontSize: 8.5,
  },
  norteiaLogoSmall: {
    height: 20,
    objectFit: "contain",
    width: 94,
  },
  pageHeader: {
    alignItems: "center",
    borderBottomColor: BORDER,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    paddingBottom: 10,
  },
  pageHeaderClient: {
    color: INK,
    fontSize: 9,
    fontWeight: 700,
  },
  pageHeaderPeriod: {
    color: MUTED,
    fontSize: 8,
  },
  section: {
    marginBottom: 24,
  },
  sectionEyebrow: {
    color: BRAND,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: INK,
    fontSize: 19,
    fontWeight: 700,
    marginBottom: 6,
  },
  sectionDescription: {
    color: MUTED,
    fontSize: 9,
    lineHeight: 1.45,
    marginBottom: 16,
  },
  chartGrid: {
    flexDirection: "row",
    marginHorizontal: -5,
  },
  chartHalf: {
    marginHorizontal: 5,
    width: "48%",
  },
  chartTitle: {
    color: INK,
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 7,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -5,
  },
  metricCard: {
    borderColor: BORDER,
    borderRadius: 9,
    borderWidth: 1,
    margin: 5,
    minHeight: 92,
    padding: 13,
    width: "48%",
  },
  metricLabel: {
    color: MUTED,
    fontSize: 8.5,
    marginBottom: 10,
  },
  metricValue: {
    color: INK,
    fontSize: 21,
    fontWeight: 700,
  },
  deltaRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: 8,
  },
  deltaPositive: {
    color: POSITIVE,
    fontSize: 8.5,
    fontWeight: 700,
  },
  deltaNegative: {
    color: NEGATIVE,
    fontSize: 8.5,
    fontWeight: 700,
  },
  deltaNeutral: {
    color: MUTED,
    fontSize: 8.5,
  },
  deltaContext: {
    color: MUTED,
    fontSize: 7.5,
    marginLeft: 5,
  },
  postCard: {
    borderColor: BORDER,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 12,
    minHeight: 132,
    padding: 8,
  },
  postThumbnail: {
    backgroundColor: BRAND_SOFT,
    borderRadius: 7,
    height: 116,
    objectFit: "cover",
    width: 116,
  },
  postThumbnailFallback: {
    alignItems: "center",
    backgroundColor: BRAND_SOFT,
    borderRadius: 7,
    height: 116,
    justifyContent: "center",
    width: 116,
  },
  postFallbackText: {
    color: BRAND,
    fontSize: 9,
    fontWeight: 700,
  },
  postContent: {
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    width: 350,
  },
  postIndex: {
    color: BRAND,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.8,
    marginBottom: 7,
    textTransform: "uppercase",
  },
  postCaption: {
    color: INK,
    fontSize: 10,
    lineHeight: 1.45,
    marginBottom: 10,
  },
  postMeta: {
    color: MUTED,
    fontSize: 8.5,
    marginBottom: 6,
  },
  postLink: {
    color: BRAND,
    fontSize: 8,
    textDecoration: "none",
  },
  empty: {
    backgroundColor: "#F7F9F9",
    borderColor: BORDER,
    borderRadius: 9,
    borderStyle: "dashed",
    borderWidth: 1,
    color: MUTED,
    fontSize: 9,
    padding: 18,
    textAlign: "center",
  },
  finalPage: {
    alignItems: "center",
    backgroundColor: PAPER,
    color: INK,
    fontFamily: "Helvetica",
    justifyContent: "center",
    padding: 54,
  },
  finalLogo: {
    height: 36,
    objectFit: "contain",
    width: 170,
  },
  finalDivider: {
    backgroundColor: BRAND,
    height: 3,
    marginVertical: 24,
    width: 42,
  },
  finalTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 8,
  },
  finalText: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 1.5,
    maxWidth: 330,
    textAlign: "center",
  },
  footer: {
    bottom: 24,
    color: MUTED,
    flexDirection: "row",
    fontSize: 7.5,
    justifyContent: "space-between",
    left: 38,
    position: "absolute",
    right: 38,
  },
});

function PageHeader({ client, period }: { client: ReportPdfClient; period: ReportPdfPeriod }) {
  return (
    <View style={styles.pageHeader}>
      <Text style={styles.pageHeaderClient}>{client.name}</Text>
      <Text style={styles.pageHeaderPeriod}>{formatDate(period.from)} — {formatDate(period.to)}</Text>
    </View>
  );
}

function PageFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text>Relatório de desempenho · Norteia</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function MetricCard({ metric }: { metric: MetricDefinition }) {
  const hasDelta = metric.delta != null && Number.isFinite(metric.delta);
  return (
    <View style={styles.metricCard} wrap={false}>
      <Text style={styles.metricLabel}>{metric.label}</Text>
      <Text style={styles.metricValue}>{formatNumber(metric.value)}</Text>
      <View style={styles.deltaRow}>
        {hasDelta ? (
          <>
            <Text style={metric.delta! > 0 ? styles.deltaPositive : metric.delta! < 0 ? styles.deltaNegative : styles.deltaNeutral}>
              {formatDelta(metric.delta!)}
            </Text>
            <Text style={styles.deltaContext}>vs. período anterior</Text>
          </>
        ) : (
          <Text style={styles.deltaNeutral}>{metric.note ?? "Comparativo indisponível"}</Text>
        )}
      </View>
    </View>
  );
}

function PostCard({ post, index }: { post: MediaItem; index: number }) {
  const thumbnail = post.thumbnail_url || post.media_url;
  const caption = post.caption?.trim() || post.media_product_type || post.media_type || "Publicação";
  return (
    <View style={styles.postCard} wrap={false}>
      {thumbnail ? (
        <Image src={thumbnail} style={styles.postThumbnail} />
      ) : (
        <View style={styles.postThumbnailFallback}>
          <Text style={styles.postFallbackText}>SEM IMAGEM</Text>
        </View>
      )}
      <View style={styles.postContent}>
        <Text style={styles.postIndex}>Conteúdo #{index + 1}</Text>
        <Text style={styles.postCaption}>{caption.slice(0, 150)}</Text>
        <Text style={styles.postMeta}>
          {(post.like_count ?? 0).toLocaleString("pt-BR")} curtidas · {(post.comments_count ?? 0).toLocaleString("pt-BR")} comentários · {engagementOf(post).toLocaleString("pt-BR")} interações
        </Text>
        {post.timestamp && <Text style={styles.postMeta}>Publicado em {formatDate(post.timestamp.slice(0, 10))}</Text>}
        {post.permalink && <Link src={post.permalink} style={styles.postLink}>Abrir publicação</Link>}
      </View>
    </View>
  );
}

export function ReportPdfDocument({
  client,
  period,
  insights,
  deltas,
  generatedAt = new Date(),
  norteiaLogoUrl = "/brand/norteia/logo/NORTEIA.png",
}: ReportPdfDocumentProps) {
  const media = Array.isArray(insights.media) ? insights.media : [];
  const engagement = media.reduce((total, item) => total + engagementOf(item), 0);
  const newFollowers = (insights.new_followers ?? []).reduce((total, item) => total + (item.value ?? 0), 0);
  const topPosts = [...media].sort((a, b) => engagementOf(b) - engagementOf(a)).slice(0, 4);
  const reachSeries: ReportPdfChartPoint[] = (insights.account_insights ?? [])
    .flatMap((metric) => metric.values ?? [])
    .map((entry) => ({
      label: entry.end_time ? entry.end_time.slice(5, 10) : "",
      value: entry.value ?? 0,
    }));
  const followersSeries: ReportPdfChartPoint[] = (insights.new_followers ?? []).map((entry) => ({
    label: entry.end_time ? entry.end_time.slice(5, 10) : "",
    value: entry.value ?? 0,
  }));
  const engagementSeries: ReportPdfChartPoint[] = topPosts.map((post, index) => ({
    label: `#${index + 1}`,
    value: engagementOf(post),
  }));
  const ageSeries: ReportPdfChartPoint[] = (insights.demographics?.idade ?? []).map((entry) => ({
    label: entry.chave,
    value: entry.valor,
  }));
  const genderSeries: ReportPdfChartPoint[] = (insights.demographics?.genero ?? []).map((entry) => ({
    label: entry.chave === "F" ? "Feminino" : entry.chave === "M" ? "Masculino" : entry.chave,
    value: entry.valor,
  }));
  const citySeries: ReportPdfChartPoint[] = (insights.demographics?.cidade ?? []).slice(0, 6).map((entry) => ({
    label: entry.chave,
    value: entry.valor,
  }));
  const metrics: MetricDefinition[] = [
    {
      label: "Seguidores",
      value: insights.profile?.followers_count ?? null,
      delta: deltas?.followers,
    },
    {
      label: "Alcance",
      value: insights.reach_total,
      delta: deltas?.reach ?? pctDelta(insights.reach_total, insights.previous_reach_total),
    },
    {
      label: "Engajamento",
      value: engagement,
      delta: deltas?.engagement,
      note: `${media.length} conteúdos analisados`,
    },
    {
      label: "Novos seguidores",
      value: insights.new_followers == null ? null : newFollowers,
      delta: deltas?.newFollowers,
    },
  ];
  const logo = assetUrl(norteiaLogoUrl);

  return (
    <Document
      title={`Relatório de desempenho — ${client.name}`}
      author="Norteia"
      subject={`Desempenho de ${formatDate(period.from)} a ${formatDate(period.to)}`}
      creator="Norteia"
    >
      <Page size="A4" style={styles.cover}>
        <View style={styles.coverBand} fixed />
        <View style={styles.coverContent}>
          <Text style={styles.coverEyebrow}>Norteia · Inteligência de desempenho</Text>
          <View style={styles.clientIdentity}>
            {client.logoUrl ? (
              <Image src={client.logoUrl} style={styles.clientLogo} />
            ) : (
              <View style={styles.clientFallback}>
                <Text style={styles.clientInitial}>{client.name.trim().charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.clientName}>{client.name}</Text>
          </View>
          <Text style={styles.coverTitle}>Relatório de desempenho</Text>
          <Text style={styles.coverSubtitle}>Uma leitura objetiva dos principais resultados de Instagram e Facebook, preparada para apoiar as próximas decisões.</Text>
          <View style={styles.periodBox}>
            <View style={styles.periodColumn}>
              <Text style={styles.periodLabel}>Período analisado</Text>
              <Text style={styles.periodValue}>{formatDate(period.from)}{"\n"}a {formatDate(period.to)}</Text>
            </View>
            <View style={styles.periodDivider} />
            <View style={styles.periodColumn}>
              <Text style={styles.periodLabel}>Período comparativo</Text>
              <Text style={styles.periodValue}>
                {period.compareFrom && period.compareTo
                  ? `${formatDate(period.compareFrom)}\na ${formatDate(period.compareTo)}`
                  : "Não informado"}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.coverFooter}>
          <Text style={styles.generated}>Gerado em {formatGeneratedAt(generatedAt)}</Text>
          <Image src={logo} style={styles.norteiaLogoSmall} />
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <PageHeader client={client} period={period} />
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>Visão geral</Text>
          <Text style={styles.sectionTitle}>Indicadores principais</Text>
          <Text style={styles.sectionDescription}>Os valores abaixo refletem somente as métricas disponibilizadas pela Meta para o período selecionado.</Text>
          <View style={styles.metricsGrid}>
            {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
          </View>
        </View>
        {insights.facebook && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionEyebrow}>Facebook</Text>
            <Text style={styles.sectionTitle}>{insights.facebook.name || "Desempenho da página"}</Text>
            <View style={styles.metricsGrid}>
              <MetricCard metric={{ label: "Seguidores", value: insights.facebook.followers ?? null }} />
              <MetricCard metric={{ label: "Alcance", value: insights.facebook.reach ?? null }} />
              <MetricCard metric={{ label: "Visualizações", value: insights.facebook.views ?? null }} />
              <MetricCard metric={{ label: "Engajamento", value: insights.facebook.engagement ?? null }} />
            </View>
          </View>
        )}
        <PageFooter />
      </Page>

      <Page size="A4" style={styles.page} wrap={false}>
        <PageHeader client={client} period={period} />
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>Evolução</Text>
          <Text style={styles.sectionTitle}>Desempenho ao longo do período</Text>
          <Text style={styles.sectionDescription}>Gráficos vetoriais construídos somente com os dados retornados pela integração.</Text>
          {reachSeries.length > 0 && (
            <View wrap={false}>
              <Text style={styles.chartTitle}>Alcance por dia</Text>
              <ReportPdfLineChart data={reachSeries} />
            </View>
          )}
          {followersSeries.length > 0 && (
            <View wrap={false}>
              <Text style={styles.chartTitle}>Novos seguidores por dia</Text>
              <ReportPdfLineChart data={followersSeries} />
            </View>
          )}
          {engagementSeries.length > 0 && (
            <View wrap={false}>
              <Text style={styles.chartTitle}>Engajamento dos principais posts</Text>
              <ReportPdfBarChart data={engagementSeries} />
            </View>
          )}
        </View>
        <PageFooter />
      </Page>

      <Page size="A4" style={styles.page} wrap={false}>
        <PageHeader client={client} period={period} />
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>Audiência</Text>
          <Text style={styles.sectionTitle}>Perfil dos seguidores</Text>
          <Text style={styles.sectionDescription}>Distribuições demográficas disponibilizadas pela Meta para a conta analisada.</Text>
          {ageSeries.length > 0 && (
            <View wrap={false}>
              <Text style={styles.chartTitle}>Seguidores por faixa etária</Text>
              <ReportPdfBarChart data={ageSeries} />
            </View>
          )}
          <View style={styles.chartGrid}>
            {genderSeries.length > 0 && (
              <View style={styles.chartHalf} wrap={false}>
                <Text style={styles.chartTitle}>Seguidores por gênero</Text>
                <ReportPdfProgressChart data={genderSeries} />
              </View>
            )}
            {citySeries.length > 0 && (
              <View style={styles.chartHalf} wrap={false}>
                <Text style={styles.chartTitle}>Principais cidades</Text>
                <ReportPdfProgressChart data={citySeries} />
              </View>
            )}
          </View>
          {ageSeries.length === 0 && genderSeries.length === 0 && citySeries.length === 0 && (
            <Text style={styles.empty}>Dados demográficos indisponíveis para este período.</Text>
          )}
        </View>
        <PageFooter />
      </Page>

      <Page size="A4" style={styles.page} wrap={false}>
        <PageHeader client={client} period={period} />
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>Conteúdo</Text>
          <Text style={styles.sectionTitle}>Principais posts</Text>
          <Text style={styles.sectionDescription}>Ranking por curtidas e comentários entre os conteúdos retornados pela integração.</Text>
          {topPosts.length > 0
            ? topPosts.map((post, index) => <PostCard key={post.id} post={post} index={index} />)
            : <Text style={styles.empty}>Nenhum post foi disponibilizado para este período.</Text>}
        </View>
        <PageFooter />
      </Page>

      <Page size="A4" style={styles.finalPage}>
        <Image src={logo} style={styles.finalLogo} />
        <View style={styles.finalDivider} />
        <Text style={styles.finalTitle}>Relatório gerado com Norteia</Text>
        <Text style={styles.finalText}>Métricas dependem da disponibilidade, permissões e políticas vigentes das plataformas Meta.</Text>
      </Page>
    </Document>
  );
}
