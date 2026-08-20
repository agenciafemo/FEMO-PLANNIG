-- ============================================================================
-- SEED do calendário comercial (interpretado das listas por segmento).
--   • segment = NULL  -> data UNIVERSAL (aparece para todos os clientes).
--   • segment = 'x'   -> só para clientes daquele segmento.
--   • Datas MÓVEIS usam recurrence_rule e devem ter month/day NULL, conforme
--     commemorative_dates_valid_fixed_date. O sistema calcula a data por ano.
-- Idempotente: não duplica (anti-join por título normalizado + regra + segmento).
-- Roda na org que tem mais clientes (a FEMO).
-- ============================================================================

WITH org AS (
  SELECT organization_id AS id
  FROM public.clients
  WHERE organization_id IS NOT NULL
  GROUP BY organization_id
  ORDER BY count(*) DESC
  LIMIT 1
),
seed(title, month, day, category, recurrence_rule, segment) AS (
  VALUES
    -- ===== UNIVERSAIS (todos os clientes) =====
    ('Dia Internacional da Mulher', 3, 8, 'varejo', 'fixed', NULL),
    ('Dia das Mães', NULL, NULL, 'varejo', 'mothers_day', NULL),
    ('Dia dos Namorados', 6, 12, 'varejo', 'fixed', NULL),
    ('Dia dos Pais', NULL, NULL, 'varejo', 'fathers_day', NULL),
    ('Dia do Cliente', 9, 15, 'varejo', 'fixed', NULL),
    ('Dia das Crianças', 10, 12, 'varejo', 'fixed', NULL),
    ('Natal', 12, 25, 'varejo', 'fixed', NULL),
    ('Réveillon', 12, 31, 'varejo', 'fixed', NULL),
    ('Páscoa', NULL, NULL, 'sazonal', 'easter', NULL),
    ('Carnaval', NULL, NULL, 'sazonal', 'carnival', NULL),
    ('Black Friday', NULL, NULL, 'varejo', 'black_friday', NULL),

    -- ===== MÉDICOS / SAÚDE =====
    ('Dia Mundial contra o Câncer', 2, 4, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial do Enfermo', 2, 11, 'nacional', 'fixed', 'medicos'),
    ('Dia Internacional de Luta contra o Câncer na Infância', 2, 15, 'nacional', 'fixed', 'medicos'),
    ('Dia Internacional da Felicidade', 3, 20, 'nacional', 'fixed', 'medicos'),
    ('Dia Internacional da Síndrome de Down', 3, 21, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial da Tuberculose', 3, 24, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial da Saúde', 4, 7, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial do Combate ao Câncer', 4, 8, 'nacional', 'fixed', 'medicos'),
    ('Dia do Infectologista', 4, 11, 'nacional', 'fixed', 'medicos'),
    ('Dia do Obstetra', 4, 12, 'nacional', 'fixed', 'medicos'),
    ('Dia Nacional do Livro Infantil', 4, 18, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial da Segurança e Saúde no Trabalho', 4, 28, 'nacional', 'fixed', 'medicos'),
    ('Dia do Oftalmologista', 5, 7, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial do Enfermeiro', 5, 12, 'nacional', 'fixed', 'medicos'),
    ('Dia Internacional das Famílias', 5, 15, 'nacional', 'fixed', 'medicos'),
    ('Dia Nacional de Enfrentamento ao Abuso e à Exploração Sexual de Crianças e Adolescentes', 5, 18, 'nacional', 'fixed', 'medicos'),
    ('Dia Nacional de Combate à Cefaleia', 5, 19, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial do Meio Ambiente', 6, 5, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial contra o Trabalho Infantil', 6, 12, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial do Doador de Sangue', 6, 14, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial de Conscientização da Violência contra a Pessoa Idosa', 6, 15, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial do Refugiado', 6, 20, 'nacional', 'fixed', 'medicos'),
    ('Dia Nacional da Saúde', 8, 5, 'nacional', 'fixed', 'medicos'),
    ('Dia do Psiquiatra', 8, 13, 'nacional', 'fixed', 'medicos'),
    ('Dia do Cardiologista', 8, 14, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial Humanitário', 8, 19, 'nacional', 'fixed', 'medicos'),
    ('Dia do Psicólogo', 8, 27, 'nacional', 'fixed', 'medicos'),
    ('Dia Nacional de Combate ao Fumo', 8, 29, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial de Prevenção do Suicídio', 9, 10, 'nacional', 'fixed', 'medicos'),
    ('Dia Nacional de Luta da Pessoa com Deficiência', 9, 21, 'nacional', 'fixed', 'medicos'),
    ('Dia Nacional do Surdo', 9, 26, 'nacional', 'fixed', 'medicos'),
    ('Dia Internacional da Pessoa Idosa', 10, 1, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial da Saúde Mental', 10, 10, 'nacional', 'fixed', 'medicos'),
    ('Dia do Fisioterapeuta e Terapeuta Ocupacional', 10, 13, 'nacional', 'fixed', 'medicos'),
    ('Dia do Anestesiologista', 10, 16, 'nacional', 'fixed', 'medicos'),
    ('Dia do Médico', 10, 18, 'nacional', 'fixed', 'medicos'),
    ('Dia Nacional do Doador de Sangue', 11, 25, 'nacional', 'fixed', 'medicos'),
    ('Dia Internacional da Luta contra a AIDS', 12, 1, 'nacional', 'fixed', 'medicos'),
    ('Dia Internacional da Pessoa com Deficiência', 12, 3, 'nacional', 'fixed', 'medicos'),
    ('Dia do Médico Cirurgião Plástico', 12, 7, 'nacional', 'fixed', 'medicos'),
    ('Dia do Fonoaudiólogo', 12, 9, 'nacional', 'fixed', 'medicos'),
    ('Dia Mundial da Cobertura Universal de Saúde', 12, 12, 'nacional', 'fixed', 'medicos'),

    -- ===== AUTO CENTER / MECÂNICA =====
    ('Dia do Automóvel', 5, 13, 'nacional', 'fixed', 'mecanica'),
    ('Dia Nacional do Progresso', 6, 27, 'nacional', 'fixed', 'mecanica'),
    ('Dia do Motorista', 7, 25, 'nacional', 'fixed', 'mecanica'),
    ('Dia do Motociclista', 7, 27, 'nacional', 'fixed', 'mecanica'),
    ('Dia Nacional do Trânsito', 9, 25, 'nacional', 'fixed', 'mecanica'),
    ('Dia do Mecânico', 12, 20, 'nacional', 'fixed', 'mecanica'),

    -- ===== INDÚSTRIA / SIDERÚRGICA =====
    ('Dia Nacional do Aço', 4, 9, 'nacional', 'fixed', 'industria'),
    ('Dia da Engenharia', 4, 10, 'nacional', 'fixed', 'industria'),
    ('Dia do Metalúrgico', 4, 21, 'nacional', 'fixed', 'industria'),
    ('Dia Mundial da Segurança e Saúde no Trabalho', 4, 28, 'nacional', 'fixed', 'industria'),
    ('Dia da Indústria', 5, 25, 'nacional', 'fixed', 'industria'),
    ('Dia Mundial do Meio Ambiente', 6, 5, 'nacional', 'fixed', 'industria'),
    ('Dia das Micro, Pequenas e Médias Empresas', 6, 27, 'nacional', 'fixed', 'industria'),
    ('Dia do Engenheiro de Saneamento', 7, 13, 'nacional', 'fixed', 'industria'),
    ('Dia do Agricultor', 7, 28, 'nacional', 'fixed', 'industria'),
    ('Dia do Técnico Industrial', 9, 23, 'nacional', 'fixed', 'industria'),
    ('Dia do Tecnólogo', 10, 6, 'nacional', 'fixed', 'industria'),
    ('Dia da Indústria Aeronáutica Brasileira', 10, 17, 'nacional', 'fixed', 'industria'),
    ('Dia do Trabalhador da Construção Civil', 10, 26, 'nacional', 'fixed', 'industria'),
    ('Dia do Engenheiro Eletricista', 11, 23, 'nacional', 'fixed', 'industria'),
    ('Dia do Técnico da Segurança do Trabalho', 11, 27, 'nacional', 'fixed', 'industria'),
    ('Dia do Engenheiro', 12, 11, 'nacional', 'fixed', 'industria'),

    -- ===== DENTISTA / ODONTOLOGIA =====
    ('Dia Internacional da Felicidade', 3, 20, 'nacional', 'fixed', 'dentista'),
    ('Dia Mundial da Saúde', 4, 7, 'nacional', 'fixed', 'dentista'),
    ('Dia do Dentista', 6, 9, 'nacional', 'fixed', 'dentista'),
    ('Dia Mundial do Dentista', 10, 3, 'nacional', 'fixed', 'dentista'),
    ('Dia do Dentista Brasileiro', 10, 25, 'nacional', 'fixed', 'dentista'),
    ('Dia Nacional da Saúde Bucal', 10, 25, 'nacional', 'fixed', 'dentista'),

    -- ===== ALIMENTOS / BALAS =====
    ('Dia da Amizade', 2, 14, 'sazonal', 'fixed', 'alimentos'),
    ('Dia Internacional da Felicidade', 3, 20, 'sazonal', 'fixed', 'alimentos'),
    ('Dia Internacional das Famílias', 5, 15, 'sazonal', 'fixed', 'alimentos'),
    ('Dia Mundial do Chocolate', 7, 7, 'sazonal', 'fixed', 'alimentos'),
    ('Dia do Amigo', 7, 20, 'sazonal', 'fixed', 'alimentos'),
    ('Dia da Amazônia', 9, 5, 'sazonal', 'fixed', 'alimentos'),
    ('Dia Nacional do Idoso', 10, 1, 'sazonal', 'fixed', 'alimentos'),
    ('Halloween', 10, 31, 'varejo', 'fixed', 'alimentos'),
    ('Dia Mundial da Gentileza', 11, 13, 'sazonal', 'fixed', 'alimentos'),

    -- ===== FARMÁCIA DE MANIPULAÇÃO =====
    ('Dia do Farmacêutico', 1, 20, 'nacional', 'fixed', 'farmacia'),
    ('Dia do Propagandista Farmacêutico', 4, 5, 'nacional', 'fixed', 'farmacia'),
    ('Dia Mundial da Saúde', 4, 7, 'nacional', 'fixed', 'farmacia'),
    ('Dia Mundial sem Tabaco', 5, 31, 'nacional', 'fixed', 'farmacia'),
    ('Dia Nacional da Saúde', 8, 5, 'nacional', 'fixed', 'farmacia'),
    ('Dia Nacional de Combate ao Fumo', 8, 29, 'nacional', 'fixed', 'farmacia'),
    ('Dia Oficial da Farmácia', 9, 5, 'nacional', 'fixed', 'farmacia'),
    ('Dia Mundial da Saúde Mental', 10, 10, 'nacional', 'fixed', 'farmacia'),
    ('Dia do Biomédico', 11, 20, 'nacional', 'fixed', 'farmacia'),
    ('Dia Internacional da Luta contra a AIDS', 12, 1, 'nacional', 'fixed', 'farmacia'),
    ('Dia Mundial da Cobertura Universal de Saúde', 12, 12, 'nacional', 'fixed', 'farmacia'),

    -- ===== MODA / VESTUÁRIO =====
    ('Dia Internacional da Dança', 4, 29, 'sazonal', 'fixed', 'moda'),
    ('Dia do Amigo', 7, 20, 'varejo', 'fixed', 'moda'),
    ('Dia dos Solteiros', 8, 13, 'varejo', 'fixed', 'moda'),
    ('Início da Primavera', 9, 21, 'sazonal', 'fixed', 'moda'),
    ('Halloween', 10, 31, 'varejo', 'fixed', 'moda'),
    ('Início do Verão', 12, 21, 'sazonal', 'fixed', 'moda'),

    -- ===== UNIFORMES / CORPORATIVO =====
    ('Dia do Empresário Contábil', 1, 12, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Publicitário', 2, 1, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Gráfico', 2, 7, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Repórter', 2, 16, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Telefone', 3, 10, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Diplomata', 4, 20, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Agente de Viagem', 4, 24, 'nacional', 'fixed', 'uniformes'),
    ('Dia Mundial da Segurança e Saúde no Trabalho', 4, 28, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Profissional de Marketing', 5, 8, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Assistente Social', 5, 15, 'nacional', 'fixed', 'uniformes'),
    ('Dia da Indústria', 5, 25, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Profissional Liberal', 5, 27, 'nacional', 'fixed', 'uniformes'),
    ('Dia das Micro, Pequenas e Médias Empresas', 6, 27, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Operador de Telemarketing', 7, 4, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Panificador', 7, 8, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Comerciante', 7, 16, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Motorista', 7, 25, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Agricultor', 7, 28, 'nacional', 'fixed', 'uniformes'),
    ('Dia Nacional dos Profissionais da Educação', 8, 6, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Garçom', 8, 11, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Técnico Industrial', 9, 23, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Empreendedor', 10, 5, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Açougueiro', 10, 9, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Professor', 10, 15, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Médico', 10, 18, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Profissional da Informática', 10, 19, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Dentista Brasileiro', 10, 25, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Trabalhador da Construção Civil', 10, 26, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Cabeleireiro', 11, 3, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Técnico da Segurança do Trabalho', 11, 27, 'nacional', 'fixed', 'uniformes'),
    ('Dia da Propaganda', 12, 4, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Engenheiro', 12, 11, 'nacional', 'fixed', 'uniformes'),
    ('Dia do Mecânico', 12, 20, 'nacional', 'fixed', 'uniformes')
)
INSERT INTO public.commemorative_dates
  (organization_id, title, month, day, category, recurring, recurrence_rule, segment, client_id)
SELECT org.id, s.title, s.month, s.day, s.category, true, s.recurrence_rule, s.segment, NULL
FROM seed s CROSS JOIN org
WHERE NOT EXISTS (
  SELECT 1 FROM public.commemorative_dates d
  WHERE lower(btrim(d.title)) = lower(btrim(s.title))
    AND d.recurrence_rule = s.recurrence_rule
    AND d.client_id IS NULL
    AND (
      -- Uma data universal global já atende todas as organizações; não crie
      -- uma segunda cópia da mesma data dentro da organização.
      (
        s.segment IS NULL
        AND d.segment IS NULL
        AND (d.organization_id IS NULL OR d.organization_id = org.id)
      )
      OR
      -- Datas segmentadas pertencem à organização e continuam isoladas dela.
      (
        s.segment IS NOT NULL
        AND d.organization_id = org.id
        AND d.segment = s.segment
      )
    )
);
