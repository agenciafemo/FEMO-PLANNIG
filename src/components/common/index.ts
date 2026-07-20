// Subconjunto de componentes comuns necessário ao Cofre. O index completo
// (com MetricCard e SectionHeader) vive na branch da fundação visual; aqui só
// entram os três que o Cofre importa, para a branch deploy/vault compilar sem
// arrastar o commit visual inteiro.
export { PageHeader } from "./PageHeader";
export { StatusBadge, STATUS_MAP } from "./StatusBadge";
export type { StatusKey, StatusVariant } from "./StatusBadge";
export { EmptyState } from "./EmptyState";
