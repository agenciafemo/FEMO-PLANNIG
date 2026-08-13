// Página pública de Política de Privacidade + Exclusão de dados.
// Serve para o campo "URL da Política de Privacidade" do app da Meta e para o
// "URL de instruções de exclusão de dados". Não exige login.

const ATUALIZADO_EM = "13 de agosto de 2026";
const CONTATO_EMAIL = "agenciafemo@gmail.com";

export default function Privacidade() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-10 border-b border-border/70 pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Política de Privacidade — Norteia</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Última atualização: {ATUALIZADO_EM}
          </p>
        </header>

        <div className="space-y-8 text-[15px] leading-relaxed">
          <section>
            <p>
              O <strong>Norteia</strong> é uma ferramenta interna da <strong>Agência Femo</strong> (FMXD
              Experiência Digital Ltda) para planejamento, aprovação, agendamento e análise de conteúdo de
              redes sociais dos clientes da agência. Esta política explica quais dados tratamos, como os
              usamos e quais são os seus direitos.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">1. Quais dados coletamos</h2>
            <ul className="ml-5 list-disc space-y-2">
              <li>
                <strong>Dados de conta:</strong> nome e e-mail dos usuários da agência que acessam o sistema.
              </li>
              <li>
                <strong>Conteúdo de trabalho:</strong> planejamentos, textos, imagens, vídeos e comentários
                criados para os clientes.
              </li>
              <li>
                <strong>Dados das redes sociais (via plataformas da Meta):</strong> quando um perfil de
                Instagram/Facebook de um cliente é conectado com autorização, acessamos informações da conta
                profissional — como identificador da conta, publicações, e métricas de desempenho
                (alcance, visualizações, engajamento, seguidores). Esse acesso usa as APIs oficiais da Meta e
                depende de autorização explícita do titular da conta.
              </li>
              <li>
                <strong>Registros de ponto da equipe:</strong> horários de entrada/saída dos colaboradores da
                agência, para controle interno de jornada.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">2. Como usamos os dados</h2>
            <ul className="ml-5 list-disc space-y-2">
              <li>Organizar o planejamento e a aprovação de conteúdo dos clientes.</li>
              <li>Agendar e publicar publicações no Instagram/Facebook em nome dos clientes, com autorização.</li>
              <li>Gerar relatórios de desempenho a partir das métricas fornecidas pelas plataformas da Meta.</li>
              <li>Gerenciar a operação interna da agência (tarefas, calendário, ponto).</li>
            </ul>
            <p className="mt-3">
              Não vendemos dados a terceiros e não usamos os dados dos clientes para finalidades alheias à
              prestação do serviço da agência.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">3. Plataformas da Meta (Instagram e Facebook)</h2>
            <p>
              O Norteia integra-se às APIs da Meta (Instagram Graph API e Facebook) exclusivamente para
              publicar conteúdo e ler métricas das contas profissionais conectadas, sempre mediante
              autorização. O uso desses dados segue os{" "}
              <a
                href="https://developers.facebook.com/terms/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand underline"
              >
                Termos da Plataforma da Meta
              </a>
              . Os tokens de acesso são armazenados de forma restrita e usados apenas pelos servidores do
              sistema para as ações autorizadas.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">4. Armazenamento e segurança</h2>
            <p>
              Os dados são armazenados em infraestrutura de nuvem segura (Supabase), com controle de acesso por
              organização e regras de segurança em nível de linha. O acesso é restrito aos usuários autorizados
              da agência. Tokens e credenciais sensíveis ficam protegidos e nunca são expostos ao navegador.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">5. Compartilhamento</h2>
            <p>
              Compartilhamos dados apenas com: (a) as próprias plataformas da Meta, para executar as ações
              autorizadas (publicar/ler métricas); e (b) provedores de infraestrutura necessários para o
              funcionamento do sistema. Não há venda ou compartilhamento para publicidade de terceiros.
            </p>
          </section>

          <section id="exclusao">
            <h2 className="mb-3 text-xl font-semibold">6. Exclusão de dados</h2>
            <p>
              Você pode solicitar a exclusão dos seus dados a qualquer momento. Para isso:
            </p>
            <ul className="ml-5 mt-2 list-disc space-y-2">
              <li>
                Envie um e-mail para{" "}
                <a href={`mailto:${CONTATO_EMAIL}`} className="text-brand underline">
                  {CONTATO_EMAIL}
                </a>{" "}
                com o assunto <strong>"Exclusão de dados"</strong>, informando a conta/perfil a ser removido.
              </li>
              <li>
                Para desconectar uma conta de Instagram/Facebook, basta desconectá-la dentro do sistema (ou
                remover a permissão do app nas configurações da sua conta da Meta) — os tokens de acesso são
                descartados.
              </li>
            </ul>
            <p className="mt-2">
              Concluímos as solicitações de exclusão em até 30 dias, salvo obrigações legais de retenção.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">7. Seus direitos</h2>
            <p>
              Conforme a LGPD, você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados,
              além de revogar consentimentos. Basta entrar em contato pelo e-mail abaixo.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold">8. Contato</h2>
            <p>
              Dúvidas sobre esta política ou sobre seus dados? Fale com a Agência Femo:{" "}
              <a href={`mailto:${CONTATO_EMAIL}`} className="text-brand underline">
                {CONTATO_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>

        <footer className="mt-12 border-t border-border/70 pt-6 text-xs text-muted-foreground">
          © 2026 Agência Femo — FMXD Experiência Digital Ltda. Todos os direitos reservados.
        </footer>
      </div>
    </div>
  );
}
