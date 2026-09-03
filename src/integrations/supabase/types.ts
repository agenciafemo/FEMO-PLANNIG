export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      categorias: {
        Row: {
          organization_id: string | null
          created_at: string
          id: string
          nome: string
          tipo: string
        }
        Insert: {
          organization_id?: string | null
          created_at?: string
          id?: string
          nome: string
          tipo?: string
        }
        Update: {
          organization_id?: string | null
          created_at?: string
          id?: string
          nome?: string
          tipo?: string
        }
        Relationships: []
      }
      checklist_prospeccao: {
        Row: {
          organization_id: string | null
          activity: string
          completed: boolean
          created_at: string
          end_time: string
          id: string
          meta: string | null
          ordem: number
          start_time: string
          updated_at: string
        }
        Insert: {
          organization_id?: string | null
          activity: string
          completed?: boolean
          created_at?: string
          end_time: string
          id?: string
          meta?: string | null
          ordem?: number
          start_time: string
          updated_at?: string
        }
        Update: {
          organization_id?: string | null
          activity?: string
          completed?: boolean
          created_at?: string
          end_time?: string
          id?: string
          meta?: string | null
          ordem?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_financeiro: {
        Row: {
          client_id: string
          created_at: string
          data_aniversario: string | null
          data_saida: string | null
          data_status_alterado: string | null
          dia_vencimento: number
          id_cliente_asaas: string | null
          is_recorrente: boolean
          organization_id: string | null
          pct_social_media: number
          pct_trafego: number
          socios: string[]
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
          valor_mensalidade: number
        }
        Insert: {
          client_id: string
          created_at?: string
          data_aniversario?: string | null
          data_saida?: string | null
          data_status_alterado?: string | null
          dia_vencimento?: number
          id_cliente_asaas?: string | null
          is_recorrente?: boolean
          organization_id?: string | null
          pct_social_media?: number
          pct_trafego?: number
          socios?: string[]
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          valor_mensalidade?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          data_aniversario?: string | null
          data_saida?: string | null
          data_status_alterado?: string | null
          dia_vencimento?: number
          id_cliente_asaas?: string | null
          is_recorrente?: boolean
          organization_id?: string | null
          pct_social_media?: number
          pct_trafego?: number
          socios?: string[]
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          valor_mensalidade?: number
        }
        Relationships: []
      }
      colaboradores: {
        Row: {
          organization_id: string | null
          cargo: Database["public"]["Enums"]["cargo_colaborador"]
          created_at: string
          data_entrada: string
          funcao_id: string | null
          id: string
          nome: string
          salario_base: number
          updated_at: string
        }
        Insert: {
          organization_id?: string | null
          cargo?: Database["public"]["Enums"]["cargo_colaborador"]
          created_at?: string
          data_entrada?: string
          funcao_id?: string | null
          id?: string
          nome: string
          salario_base?: number
          updated_at?: string
        }
        Update: {
          organization_id?: string | null
          cargo?: Database["public"]["Enums"]["cargo_colaborador"]
          created_at?: string
          data_entrada?: string
          funcao_id?: string | null
          id?: string
          nome?: string
          salario_base?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "colaboradores_funcao_id_fkey"
            columns: ["funcao_id"]
            isOneToOne: false
            referencedRelation: "funcoes"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes_financeiro: {
        Row: {
          organization_id: string
          pct_penalidade_atraso: number
          pct_penalidade_churn: number
          pct_reserva: number
          pct_rotativa: number
          updated_at: string
        }
        Insert: {
          organization_id: string
          pct_penalidade_atraso?: number
          pct_penalidade_churn?: number
          pct_reserva?: number
          pct_rotativa?: number
          updated_at?: string
        }
        Update: {
          organization_id?: string
          pct_penalidade_atraso?: number
          pct_penalidade_churn?: number
          pct_reserva?: number
          pct_rotativa?: number
          updated_at?: string
        }
        Relationships: []
      }
      contratos_fatiamento: {
        Row: {
          organization_id: string | null
          client_id: string
          colaborador_id: string
          created_at: string
          id: string
          prazo_entrega_planejamentos: number | null
          status_entrega_mes_atual: Database["public"]["Enums"]["status_entrega"]
          valor_base_calculo: number
        }
        Insert: {
          organization_id?: string | null
          client_id: string
          colaborador_id: string
          created_at?: string
          id?: string
          prazo_entrega_planejamentos?: number | null
          status_entrega_mes_atual?: Database["public"]["Enums"]["status_entrega"]
          valor_base_calculo?: number
        }
        Update: {
          organization_id?: string | null
          client_id?: string
          colaborador_id?: string
          created_at?: string
          id?: string
          prazo_entrega_planejamentos?: number | null
          status_entrega_mes_atual?: Database["public"]["Enums"]["status_entrega"]
          valor_base_calculo?: number
        }
        Relationships: [
          {
            foreignKeyName: "contratos_fatiamento_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_fatiamento_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          organization_id: string | null
          cdp_validated: string
          clinic_name: string | null
          created_at: string
          current_stage: number
          general_notes: string | null
          id: string
          instagram: string | null
          last_action: string | null
          lead_name: string
          meeting_date: string | null
          pain_identified: string | null
          phone: string | null
          referrals_count: number
          response_status: string
          updated_at: string
        }
        Insert: {
          organization_id?: string | null
          cdp_validated?: string
          clinic_name?: string | null
          created_at?: string
          current_stage?: number
          general_notes?: string | null
          id?: string
          instagram?: string | null
          last_action?: string | null
          lead_name: string
          meeting_date?: string | null
          pain_identified?: string | null
          phone?: string | null
          referrals_count?: number
          response_status?: string
          updated_at?: string
        }
        Update: {
          organization_id?: string | null
          cdp_validated?: string
          clinic_name?: string | null
          created_at?: string
          current_stage?: number
          general_notes?: string | null
          id?: string
          instagram?: string | null
          last_action?: string | null
          lead_name?: string
          meeting_date?: string | null
          pain_identified?: string | null
          phone?: string | null
          referrals_count?: number
          response_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      dashboard_anual: {
        Row: {
          organization_id: string | null
          ano: number
          created_at: string
          despesas: number
          id: string
          mes: number
          observacao: string | null
          receitas: number
          retirada: number
          updated_at: string
        }
        Insert: {
          organization_id?: string | null
          ano: number
          created_at?: string
          despesas?: number
          id?: string
          mes: number
          observacao?: string | null
          receitas?: number
          retirada?: number
          updated_at?: string
        }
        Update: {
          organization_id?: string | null
          ano?: number
          created_at?: string
          despesas?: number
          id?: string
          mes?: number
          observacao?: string | null
          receitas?: number
          retirada?: number
          updated_at?: string
        }
        Relationships: []
      }
      funcoes: {
        Row: {
          organization_id: string | null
          created_at: string
          descricao: string | null
          id: string
          nome: string
          tipo_base: string
          updated_at: string
        }
        Insert: {
          organization_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          tipo_base?: string
          updated_at?: string
        }
        Update: {
          organization_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          tipo_base?: string
          updated_at?: string
        }
        Relationships: []
      }
      historico_folha_pagamento: {
        Row: {
          organization_id: string | null
          colaborador_id: string
          created_at: string
          id: string
          mes_competencia: string
          observacoes: string | null
          salario_base: number
          total_comissoes: number
          total_descontos: number
          total_extras: number
          total_manual: number | null
          updated_at: string
          valor_liquido: number
        }
        Insert: {
          organization_id?: string | null
          colaborador_id: string
          created_at?: string
          id?: string
          mes_competencia: string
          observacoes?: string | null
          salario_base?: number
          total_comissoes?: number
          total_descontos?: number
          total_extras?: number
          total_manual?: number | null
          updated_at?: string
          valor_liquido?: number
        }
        Update: {
          organization_id?: string | null
          colaborador_id?: string
          created_at?: string
          id?: string
          mes_competencia?: string
          observacoes?: string | null
          salario_base?: number
          total_comissoes?: number
          total_descontos?: number
          total_extras?: number
          total_manual?: number | null
          updated_at?: string
          valor_liquido?: number
        }
        Relationships: [
          {
            foreignKeyName: "historico_folha_pagamento_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      lancamentos_financeiros: {
        Row: {
          import_hash: string | null
          import_lote_id: string | null
          organization_id: string | null
          categoria_id: string | null
          client_id: string | null
          codigo_pix: string | null
          colaborador_id: string | null
          created_at: string
          data_lancamento: string
          descricao: string | null
          id: string
          id_cobranca_asaas: string | null
          competencia: string | null
          is_clawback: boolean
          is_mensalidade: boolean
          link_boleto: string | null
          origem_lancamento_id: string | null
          recorrencia_ativa: boolean
          recorrencia_grupo_id: string | null
          recorrencia_indefinida: boolean
          status_pagamento: Database["public"]["Enums"]["payment_status"]
          tipo: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at: string
          valor: number
        }
        Insert: {
          import_hash?: string | null
          import_lote_id?: string | null
          organization_id?: string | null
          categoria_id?: string | null
          client_id?: string | null
          codigo_pix?: string | null
          colaborador_id?: string | null
          created_at?: string
          data_lancamento: string
          descricao?: string | null
          id?: string
          id_cobranca_asaas?: string | null
          is_clawback?: boolean
          is_mensalidade?: boolean
          link_boleto?: string | null
          origem_lancamento_id?: string | null
          recorrencia_ativa?: boolean
          recorrencia_grupo_id?: string | null
          recorrencia_indefinida?: boolean
          status_pagamento?: Database["public"]["Enums"]["payment_status"]
          tipo: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at?: string
          valor: number
        }
        Update: {
          import_hash?: string | null
          import_lote_id?: string | null
          organization_id?: string | null
          categoria_id?: string | null
          client_id?: string | null
          codigo_pix?: string | null
          colaborador_id?: string | null
          created_at?: string
          data_lancamento?: string
          descricao?: string | null
          id?: string
          id_cobranca_asaas?: string | null
          is_clawback?: boolean
          link_boleto?: string | null
          origem_lancamento_id?: string | null
          recorrencia_ativa?: boolean
          recorrencia_grupo_id?: string | null
          recorrencia_indefinida?: boolean
          status_pagamento?: Database["public"]["Enums"]["payment_status"]
          tipo?: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "lancamentos_financeiros_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_financeiros_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_financeiros_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_financeiros_origem_lancamento_id_fkey"
            columns: ["origem_lancamento_id"]
            isOneToOne: false
            referencedRelation: "lancamentos_financeiros"
            referencedColumns: ["id"]
          },
        ]
      }
      pesos_comissao_folha: {
        Row: {
          organization_id: string | null
          colaborador_id: string
          created_at: string
          id: string
          mes_competencia: string
          peso: number
          updated_at: string
        }
        Insert: {
          organization_id?: string | null
          colaborador_id: string
          created_at?: string
          id?: string
          mes_competencia: string
          peso?: number
          updated_at?: string
        }
        Update: {
          organization_id?: string | null
          colaborador_id?: string
          created_at?: string
          id?: string
          mes_competencia?: string
          peso?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pesos_comissao_folha_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      recebimentos_extras: {
        Row: {
          organization_id: string | null
          colaborador_id: string
          created_at: string
          data_referencia: string
          descricao: string
          id: string
          valor: number
        }
        Insert: {
          organization_id?: string | null
          colaborador_id: string
          created_at?: string
          data_referencia: string
          descricao: string
          id?: string
          valor: number
        }
        Update: {
          organization_id?: string | null
          colaborador_id?: string
          created_at?: string
          data_referencia?: string
          descricao?: string
          id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "recebimentos_extras_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      tabela_progressiva_ltv: {
        Row: {
          organization_id: string | null
          created_at: string
          funcao_id: string | null
          id: string
          meses_max: number | null
          meses_min: number
          percentual: number
          updated_at: string
        }
        Insert: {
          organization_id?: string | null
          created_at?: string
          funcao_id?: string | null
          id?: string
          meses_max?: number | null
          meses_min: number
          percentual: number
          updated_at?: string
        }
        Update: {
          organization_id?: string | null
          created_at?: string
          funcao_id?: string | null
          id?: string
          meses_max?: number | null
          meses_min?: number
          percentual?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tabela_progressiva_ltv_funcao_id_fkey"
            columns: ["funcao_id"]
            isOneToOne: false
            referencedRelation: "funcoes"
            referencedColumns: ["id"]
          },
        ]
      }
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      cargo_colaborador: "Social Media" | "Gestor de Tráfego" | "Outros" | "Líder"
      client_status: "Ativo" | "Churn"
      lancamento_tipo: "Entrada" | "Saída"
      payment_status: "Pago" | "Pendente" | "Inadimplente"
      status_entrega: "Entregue no Prazo" | "Entregue com Atraso"
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      calendar_events: {
        Row: {
          all_day: boolean
          client_id: string | null
          color: string
          created_at: string
          created_by: string
          end_time: string | null
          event_date: string
          event_type: string
          id: string
          note: string | null
          organization_id: string
          start_time: string | null
          title: string
        }
        Insert: {
          all_day?: boolean
          client_id?: string | null
          color?: string
          created_at?: string
          created_by: string
          end_time?: string | null
          event_date: string
          event_type: string
          id?: string
          note?: string | null
          organization_id: string
          start_time?: string | null
          title: string
        }
        Update: {
          all_day?: boolean
          client_id?: string | null
          color?: string
          created_at?: string
          created_by?: string
          end_time?: string | null
          event_date?: string
          event_type?: string
          id?: string
          note?: string | null
          organization_id?: string
          start_time?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_ad_accounts: {
        Row: {
          ad_account_id: string
          ad_account_name: string | null
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ad_account_id: string
          ad_account_name?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ad_account_id?: string
          ad_account_name?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_ad_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_ad_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_compliance_rules: {
        Row: {
          channels: string[]
          client_id: string | null
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_until: string | null
          exceptions: string | null
          id: string
          organization_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          rule_text: string
          segment: string | null
          severity: string
          source_title: string | null
          source_url: string | null
          status: string
          title: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          channels?: string[]
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          exceptions?: string | null
          id?: string
          organization_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_text: string
          segment?: string | null
          severity?: string
          source_title?: string | null
          source_url?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          channels?: string[]
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          exceptions?: string | null
          id?: string
          organization_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_text?: string
          segment?: string | null
          severity?: string
          source_title?: string | null
          source_url?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_compliance_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_compliance_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_content_claims: {
        Row: {
          approved_by: string | null
          claim_text: string
          client_id: string
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_until: string | null
          id: string
          organization_id: string
          reviewed_at: string | null
          source_title: string | null
          source_url: string | null
          status: string
          updated_at: string
          updated_by: string | null
          usage_notes: string | null
        }
        Insert: {
          approved_by?: string | null
          claim_text: string
          client_id: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          organization_id: string
          reviewed_at?: string | null
          source_title?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          usage_notes?: string | null
        }
        Update: {
          approved_by?: string | null
          claim_text?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          organization_id?: string
          reviewed_at?: string | null
          source_title?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          usage_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_content_claims_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_content_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_content_contract: {
        Row: {
          client_id: string
          created_at: string
          notes: string | null
          organization_id: string
          qty_blog: number
          qty_carousel: number
          qty_reels: number
          qty_static: number
          qty_story: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          notes?: string | null
          organization_id: string
          qty_blog?: number
          qty_carousel?: number
          qty_reels?: number
          qty_static?: number
          qty_story?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          notes?: string | null
          organization_id?: string
          qty_blog?: number
          qty_carousel?: number
          qty_reels?: number
          qty_static?: number
          qty_story?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_content_contract_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_content_contract_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_content_profiles: {
        Row: {
          audience_desires: string[]
          audience_language: string | null
          audience_objections: string[]
          audience_pains: string[]
          brand_summary: string | null
          client_id: string
          created_at: string
          differentiators: string[]
          emoji_limit: number | null
          forbidden_ctas: string[]
          forbidden_words: string[]
          formality: string | null
          id: string
          location_scope: string | null
          mandatory_disclosures: string[]
          notes: string | null
          organization_id: string
          personas: string[]
          positioning: string | null
          preferred_ctas: string[]
          preferred_words: string[]
          products_services: string[]
          segment: string | null
          sensitive_topics: string[]
          specialties: string[]
          updated_at: string
          updated_by: string | null
          voice_personality: string | null
        }
        Insert: {
          audience_desires?: string[]
          audience_language?: string | null
          audience_objections?: string[]
          audience_pains?: string[]
          brand_summary?: string | null
          client_id: string
          created_at?: string
          differentiators?: string[]
          emoji_limit?: number | null
          forbidden_ctas?: string[]
          forbidden_words?: string[]
          formality?: string | null
          id?: string
          location_scope?: string | null
          mandatory_disclosures?: string[]
          notes?: string | null
          organization_id: string
          personas?: string[]
          positioning?: string | null
          preferred_ctas?: string[]
          preferred_words?: string[]
          products_services?: string[]
          segment?: string | null
          sensitive_topics?: string[]
          specialties?: string[]
          updated_at?: string
          updated_by?: string | null
          voice_personality?: string | null
        }
        Update: {
          audience_desires?: string[]
          audience_language?: string | null
          audience_objections?: string[]
          audience_pains?: string[]
          brand_summary?: string | null
          client_id?: string
          created_at?: string
          differentiators?: string[]
          emoji_limit?: number | null
          forbidden_ctas?: string[]
          forbidden_words?: string[]
          formality?: string | null
          id?: string
          location_scope?: string | null
          mandatory_disclosures?: string[]
          notes?: string | null
          organization_id?: string
          personas?: string[]
          positioning?: string | null
          preferred_ctas?: string[]
          preferred_words?: string[]
          products_services?: string[]
          segment?: string | null
          sensitive_topics?: string[]
          specialties?: string[]
          updated_at?: string
          updated_by?: string | null
          voice_personality?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_content_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_content_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_credentials: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          notes: string | null
          organization_id: string
          password_encrypted: string
          platform: string
          responsible_user_id: string | null
          two_factor_notes_encrypted: string | null
          updated_at: string
          updated_by: string | null
          url: string | null
          username: string | null
          vault_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          password_encrypted: string
          platform: string
          responsible_user_id?: string | null
          two_factor_notes_encrypted?: string | null
          updated_at?: string
          updated_by?: string | null
          url?: string | null
          username?: string | null
          vault_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          password_encrypted?: string
          platform?: string
          responsible_user_id?: string | null
          two_factor_notes_encrypted?: string | null
          updated_at?: string
          updated_by?: string | null
          url?: string | null
          username?: string | null
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_credentials_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_credentials_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vault_status"
            referencedColumns: ["vault_id"]
          },
          {
            foreignKeyName: "client_credentials_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      client_design_references: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          image_url: string
          organization_id: string
          storage_path: string | null
          tags: string[]
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url: string
          organization_id: string
          storage_path?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string
          organization_id?: string
          storage_path?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_design_references_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_design_references_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_documents: {
        Row: {
          category: string | null
          client_id: string
          created_at: string | null
          description: string | null
          file_url: string
          id: string
          name: string
          organization_id: string
          user_id: string | null
        }
        Insert: {
          category?: string | null
          client_id: string
          created_at?: string | null
          description?: string | null
          file_url: string
          id?: string
          name: string
          organization_id: string
          user_id?: string | null
        }
        Update: {
          category?: string | null
          client_id?: string
          created_at?: string | null
          description?: string | null
          file_url?: string
          id?: string
          name?: string
          organization_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_knowledge_items: {
        Row: {
          client_id: string
          content: string | null
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_until: string | null
          id: string
          item_type: string | null
          organization_id: string
          source_url: string | null
          status: string
          tags: string[]
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          content?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          item_type?: string | null
          organization_id: string
          source_url?: string | null
          status?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          content?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          id?: string
          item_type?: string | null
          organization_id?: string
          source_url?: string | null
          status?: string
          tags?: string[]
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_knowledge_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_knowledge_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_report_history: {
        Row: {
          analysis: string | null
          client_id: string
          created_at: string
          created_by: string | null
          dados: Json | null
          id: string
          metricas: Json | null
          organization_id: string
          period_from: string | null
          period_to: string | null
        }
        Insert: {
          analysis?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          dados?: Json | null
          id?: string
          metricas?: Json | null
          organization_id: string
          period_from?: string | null
          period_to?: string | null
        }
        Update: {
          analysis?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          dados?: Json | null
          id?: string
          metricas?: Json | null
          organization_id?: string
          period_from?: string | null
          period_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_report_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_report_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          accent_color: string | null
          agency_since: string | null
          created_at: string | null
          created_by: string | null
          id: string
          logo_url: string | null
          name: string
          notes: string | null
          organization_id: string
          public_link_expires_at: string | null
          public_link_revoked: boolean
          public_link_token: string | null
          segment: string | null
          traffic_only: boolean
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
          agency_since?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name: string
          notes?: string | null
          organization_id: string
          public_link_expires_at?: string | null
          public_link_revoked?: boolean
          public_link_token?: string | null
          segment?: string | null
          traffic_only?: boolean
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
          agency_since?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          public_link_expires_at?: string | null
          public_link_revoked?: boolean
          public_link_token?: string | null
          segment?: string | null
          traffic_only?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commemorative_dates: {
        Row: {
          category: string
          client_id: string | null
          day: number | null
          id: string
          month: number | null
          organization_id: string | null
          recurrence_rule: string
          recurring: boolean
          segment: string | null
          title: string
        }
        Insert: {
          category: string
          client_id?: string | null
          day?: number | null
          id?: string
          month?: number | null
          organization_id?: string | null
          recurrence_rule?: string
          recurring?: boolean
          segment?: string | null
          title: string
        }
        Update: {
          category?: string
          client_id?: string | null
          day?: number | null
          id?: string
          month?: number | null
          organization_id?: string | null
          recurrence_rule?: string
          recurring?: boolean
          segment?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "commemorative_dates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commemorative_dates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_access_logs: {
        Row: {
          action: string
          client_id: string | null
          created_at: string
          credential_id: string | null
          id: string
          metadata: Json | null
          organization_id: string
          user_id: string
          vault_id: string | null
        }
        Insert: {
          action: string
          client_id?: string | null
          created_at?: string
          credential_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          user_id: string
          vault_id?: string | null
        }
        Update: {
          action?: string
          client_id?: string | null
          created_at?: string
          credential_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          user_id?: string
          vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_access_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_access_logs_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "client_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_access_logs_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "client_credentials_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_access_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_access_logs_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vault_status"
            referencedColumns: ["vault_id"]
          },
          {
            foreignKeyName: "credential_access_logs_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_calendar_dates: {
        Row: {
          active: boolean
          category: string
          color: string
          created_at: string
          day: number | null
          description: string | null
          id: string
          month: number | null
          name: string
          occurrence: number | null
          offset_days: number
          recurrence_kind: string
          slug: string
          weekday: number | null
        }
        Insert: {
          active?: boolean
          category?: string
          color?: string
          created_at?: string
          day?: number | null
          description?: string | null
          id?: string
          month?: number | null
          name: string
          occurrence?: number | null
          offset_days?: number
          recurrence_kind: string
          slug: string
          weekday?: number | null
        }
        Update: {
          active?: boolean
          category?: string
          color?: string
          created_at?: string
          day?: number | null
          description?: string | null
          id?: string
          month?: number | null
          name?: string
          occurrence?: number | null
          offset_days?: number
          recurrence_kind?: string
          slug?: string
          weekday?: number | null
        }
        Relationships: []
      }
      meta_connection_audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          client_id: string
          connection_id: string | null
          created_at: string
          id: string
          organization_id: string
          reason_code: string | null
          request_id: string | null
          result: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          client_id: string
          connection_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          reason_code?: string | null
          request_id?: string | null
          result: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          client_id?: string
          connection_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          reason_code?: string | null
          request_id?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_connection_audit_connection_scope_fk"
            columns: ["connection_id", "organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id", "organization_id", "client_id"]
          },
          {
            foreignKeyName: "meta_connection_audit_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_connection_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_connection_channels: {
        Row: {
          account_type: string | null
          channel_type: string
          client_id: string
          connection_id: string
          created_at: string
          display_name: string
          external_account_id: string
          id: string
          organization_id: string
          page_tasks: string[]
          status: string
          updated_at: string
          username: string | null
        }
        Insert: {
          account_type?: string | null
          channel_type: string
          client_id: string
          connection_id: string
          created_at?: string
          display_name: string
          external_account_id: string
          id?: string
          organization_id: string
          page_tasks?: string[]
          status?: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          account_type?: string | null
          channel_type?: string
          client_id?: string
          connection_id?: string
          created_at?: string
          display_name?: string
          external_account_id?: string
          id?: string
          organization_id?: string
          page_tasks?: string[]
          status?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_connection_channels_connection_scope_fk"
            columns: ["connection_id", "organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id", "organization_id", "client_id"]
          },
        ]
      }
      meta_connections: {
        Row: {
          access_token_secret_id: string | null
          client_id: string
          connected_at: string | null
          connected_by: string
          created_at: string
          disconnected_at: string | null
          granted_scopes: string[]
          id: string
          last_error_code: string | null
          last_verified_at: string | null
          meta_user_id: string | null
          meta_user_name: string | null
          organization_id: string
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_secret_id?: string | null
          client_id: string
          connected_at?: string | null
          connected_by: string
          created_at?: string
          disconnected_at?: string | null
          granted_scopes?: string[]
          id?: string
          last_error_code?: string | null
          last_verified_at?: string | null
          meta_user_id?: string | null
          meta_user_name?: string | null
          organization_id: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_secret_id?: string | null
          client_id?: string
          connected_at?: string | null
          connected_by?: string
          created_at?: string
          disconnected_at?: string | null
          granted_scopes?: string[]
          id?: string
          last_error_code?: string | null
          last_verified_at?: string | null
          meta_user_id?: string | null
          meta_user_name?: string | null
          organization_id?: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_oauth_states: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string
          id: string
          organization_id: string
          redirect_path: string
          requested_by: string
          requested_scopes: string[]
          state_hash: string
          used_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
          redirect_path?: string
          requested_by: string
          requested_scopes?: string[]
          state_hash: string
          used_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          redirect_path?: string
          requested_by?: string
          requested_scopes?: string[]
          state_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_oauth_states_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_oauth_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_scheduled_posts: {
        Row: {
          attempts: number
          caption: string
          children_urls: string[] | null
          client_id: string
          connection_id: string
          cover_url: string | null
          created_at: string
          created_by: string
          error_code: string | null
          facebook_post_id: string | null
          id: string
          image_url: string | null
          instagram_media_id: string | null
          media_type: string
          organization_id: string
          permalink: string | null
          post_id: string | null
          scheduled_for: string
          status: string
          target: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          attempts?: number
          caption?: string
          children_urls?: string[] | null
          client_id: string
          connection_id: string
          cover_url?: string | null
          created_at?: string
          created_by: string
          error_code?: string | null
          facebook_post_id?: string | null
          id?: string
          image_url?: string | null
          instagram_media_id?: string | null
          media_type?: string
          organization_id: string
          permalink?: string | null
          post_id?: string | null
          scheduled_for?: string
          status?: string
          target?: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          attempts?: number
          caption?: string
          children_urls?: string[] | null
          client_id?: string
          connection_id?: string
          cover_url?: string | null
          created_at?: string
          created_by?: string
          error_code?: string | null
          facebook_post_id?: string | null
          id?: string
          image_url?: string | null
          instagram_media_id?: string | null
          media_type?: string
          organization_id?: string
          permalink?: string | null
          post_id?: string | null
          scheduled_for?: string
          status?: string
          target?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_scheduled_posts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_scheduled_posts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_scheduled_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_scheduled_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          ai_summary: string | null
          client_id: string
          created_at: string | null
          id: string
          month: number
          organization_id: string
          pdf_url: string | null
          summary_text: string | null
          updated_at: string | null
          user_id: string | null
          year: number
        }
        Insert: {
          ai_summary?: string | null
          client_id: string
          created_at?: string | null
          id?: string
          month: number
          organization_id: string
          pdf_url?: string | null
          summary_text?: string | null
          updated_at?: string | null
          user_id?: string | null
          year: number
        }
        Update: {
          ai_summary?: string | null
          client_id?: string
          created_at?: string | null
          id?: string
          month?: number
          organization_id?: string
          pdf_url?: string | null
          summary_text?: string | null
          updated_at?: string | null
          user_id?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          id: string
          organization_id: string
          planning_id: string | null
          read: boolean | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          id?: string
          organization_id: string
          planning_id?: string | null
          read?: boolean | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string
          planning_id?: string | null
          read?: boolean | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_invitation_status"]
          token: string
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          expires_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_invitation_status"]
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_invitation_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          job_title: string | null
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          job_title?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          job_title?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_vault_members: {
        Row: {
          can_manage: boolean
          can_manage_settings: boolean
          can_reveal: boolean
          can_view: boolean
          created_at: string
          created_by: string
          id: string
          organization_id: string
          updated_at: string
          user_id: string
          vault_id: string
        }
        Insert: {
          can_manage?: boolean
          can_manage_settings?: boolean
          can_reveal?: boolean
          can_view?: boolean
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
          vault_id: string
        }
        Update: {
          can_manage?: boolean
          can_manage_settings?: boolean
          can_reveal?: boolean
          can_view?: boolean
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_vault_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_vault_members_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vault_status"
            referencedColumns: ["vault_id"]
          },
          {
            foreignKeyName: "organization_vault_members_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_vault_unlock_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          organization_id: string
          revoked_at: string | null
          unlocked_at: string
          user_id: string
          vault_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          unlocked_at?: string
          user_id: string
          vault_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          unlocked_at?: string
          user_id?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_vault_unlock_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_vault_unlock_sessions_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vault_status"
            referencedColumns: ["vault_id"]
          },
          {
            foreignKeyName: "organization_vault_unlock_sessions_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_vaults: {
        Row: {
          created_at: string
          created_by: string
          dek_secret_id: string
          failed_attempts: number
          id: string
          kdf_salt: string | null
          locked_until: string | null
          master_password_hash: string | null
          organization_id: string
          require_master_password: boolean
          status: string
          unlock_duration_minutes: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          dek_secret_id: string
          failed_attempts?: number
          id?: string
          kdf_salt?: string | null
          locked_until?: string | null
          master_password_hash?: string | null
          organization_id: string
          require_master_password?: boolean
          status?: string
          unlock_duration_minutes?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          dek_secret_id?: string
          failed_attempts?: number
          id?: string
          kdf_salt?: string | null
          locked_until?: string | null
          master_password_hash?: string | null
          organization_id?: string
          require_master_password?: boolean
          status?: string
          unlock_duration_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_vaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          brand_color: string | null
          client_limit: number | null
          created_at: string
          created_by: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          brand_color?: string | null
          client_limit?: number | null
          created_at?: string
          created_by: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          brand_color?: string | null
          client_limit?: number | null
          created_at?: string
          created_by?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      planning_nps_responses: {
        Row: {
          classification: string
          client_id: string | null
          created_at: string
          id: string
          organization_id: string
          planning_id: string
          reason: string | null
          score: number
        }
        Insert: {
          classification: string
          client_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          planning_id: string
          reason?: string | null
          score: number
        }
        Update: {
          classification?: string
          client_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          planning_id?: string
          reason?: string | null
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "planning_nps_responses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_nps_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_nps_responses_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_templates: {
        Row: {
          created_at: string | null
          default_post_count: number | null
          default_stories_count: number | null
          description: string | null
          id: string
          name: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          default_post_count?: number | null
          default_stories_count?: number | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          default_post_count?: number | null
          default_stories_count?: number | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plannings: {
        Row: {
          client_id: string
          created_at: string | null
          created_by: string | null
          id: string
          month: number
          notes: string | null
          organization_id: string
          status: string
          updated_at: string | null
          year: number
        }
        Insert: {
          client_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          month: number
          notes?: string | null
          organization_id: string
          status?: string
          updated_at?: string | null
          year: number
        }
        Update: {
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          month?: number
          notes?: string | null
          organization_id?: string
          status?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "plannings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plannings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          audio_url: string | null
          author_name: string | null
          author_type: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          post_id: string
          reason_codes: string[] | null
          text: string | null
        }
        Insert: {
          audio_url?: string | null
          author_name?: string | null
          author_type?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          post_id: string
          reason_codes?: string[] | null
          text?: string | null
        }
        Update: {
          audio_url?: string | null
          author_name?: string | null
          author_type?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          post_id?: string
          reason_codes?: string[] | null
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_edit_suggestions: {
        Row: {
          content: string | null
          created_at: string | null
          field_name: string | null
          id: string
          original_value: string | null
          post_id: string
          status: string | null
          suggested_value: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          field_name?: string | null
          id?: string
          original_value?: string | null
          post_id: string
          status?: string | null
          suggested_value?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          field_name?: string | null
          id?: string
          original_value?: string | null
          post_id?: string
          status?: string | null
          suggested_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_edit_suggestions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          blog_body: string | null
          caption: string | null
          content_type: string | null
          cover_image_url: string | null
          created_at: string | null
          hashtags: string | null
          id: string
          media_urls: Json | null
          organization_id: string
          planning_id: string
          position: number | null
          publish_date: string | null
          revision_note: string | null
          revision_reasons: string[] | null
          scheduled: boolean | null
          status: string | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          blog_body?: string | null
          caption?: string | null
          content_type?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          hashtags?: string | null
          id?: string
          media_urls?: Json | null
          organization_id: string
          planning_id: string
          position?: number | null
          publish_date?: string | null
          revision_note?: string | null
          revision_reasons?: string[] | null
          scheduled?: boolean | null
          status?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          blog_body?: string | null
          caption?: string | null
          content_type?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          hashtags?: string | null
          id?: string
          media_urls?: Json | null
          organization_id?: string
          planning_id?: string
          position?: number | null
          publish_date?: string | null
          revision_note?: string | null
          revision_reasons?: string[] | null
          scheduled?: boolean | null
          status?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
        ]
      }
      production_item_steps: {
        Row: {
          assignee_id: string | null
          capture_event_id: string | null
          created_at: string
          done: boolean
          done_at: string | null
          done_by: string | null
          id: string
          item_id: string
          kind: string
          label: string
          organization_id: string
          outcome: string | null
          position: number
          reason_codes: string[] | null
          reason_note: string | null
          scheduled_at: string | null
          schedule_source: string
          step_key: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          capture_event_id?: string | null
          created_at?: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          item_id: string
          kind?: string
          label: string
          organization_id: string
          outcome?: string | null
          position?: number
          reason_codes?: string[] | null
          reason_note?: string | null
          scheduled_at?: string | null
          schedule_source?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          capture_event_id?: string | null
          created_at?: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          item_id?: string
          kind?: string
          label?: string
          organization_id?: string
          outcome?: string | null
          position?: number
          reason_codes?: string[] | null
          reason_note?: string | null
          scheduled_at?: string | null
          schedule_source?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_item_steps_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "production_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_item_steps_capture_event_id_fkey"
            columns: ["capture_event_id"]
            isOneToOne: false
            referencedRelation: "team_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_item_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      production_items: {
        Row: {
          assignee_id: string | null
          client_id: string | null
          content_type: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          organization_id: string
          piece_number: number
          planning_id: string | null
          position: number
          post_id: string | null
          stage: string
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assignee_id?: string | null
          client_id?: string | null
          content_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          piece_number?: number
          planning_id?: string | null
          position?: number
          post_id?: string | null
          stage?: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assignee_id?: string | null
          client_id?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          piece_number?: number
          planning_id?: string | null
          position?: number
          post_id?: string | null
          stage?: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_items_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_items_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      production_role_assignees: {
        Row: {
          design_user_id: string | null
          editing_user_id: string | null
          organization_id: string
          review_user_id: string | null
          updated_at: string
          updated_by: string | null
          writing_user_id: string | null
        }
        Insert: {
          design_user_id?: string | null
          editing_user_id?: string | null
          organization_id: string
          review_user_id?: string | null
          updated_at?: string
          updated_by?: string | null
          writing_user_id?: string | null
        }
        Update: {
          design_user_id?: string | null
          editing_user_id?: string | null
          organization_id?: string
          review_user_id?: string | null
          updated_at?: string
          updated_by?: string | null
          writing_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_role_assignees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      production_step_templates: {
        Row: {
          content_type: string
          created_at: string
          id: string
          kind: string
          label: string
          organization_id: string
          position: number
          role: string | null
          step_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content_type: string
          created_at?: string
          id?: string
          kind?: string
          label: string
          organization_id: string
          position?: number
          role?: string | null
          step_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string
          organization_id?: string
          position?: number
          role?: string | null
          step_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_step_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_organization_id: string | null
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          theme_preference: string
          updated_at: string | null
        }
        Insert: {
          active_organization_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          theme_preference?: string
          updated_at?: string | null
        }
        Update: {
          active_organization_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          theme_preference?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_organization_id_fkey"
            columns: ["active_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_comments: {
        Row: {
          audio_url: string | null
          author_type: string | null
          created_at: string | null
          id: string
          report_id: string
          text: string | null
        }
        Insert: {
          audio_url?: string | null
          author_type?: string | null
          created_at?: string | null
          id?: string
          report_id: string
          text?: string | null
        }
        Update: {
          audio_url?: string | null
          author_type?: string | null
          created_at?: string | null
          id?: string
          report_id?: string
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_comments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "monthly_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      task_subtasks: {
        Row: {
          assignee_id: string | null
          done: boolean
          id: string
          position: number
          task_id: string
          title: string
        }
        Insert: {
          assignee_id?: string | null
          done?: boolean
          id?: string
          position?: number
          task_id: string
          title: string
        }
        Update: {
          assignee_id?: string | null
          done?: boolean
          id?: string
          position?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_time_entries: {
        Row: {
          duration_seconds: number | null
          ended_at: string | null
          id: string
          started_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          started_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string
          client_id: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string
          id: string
          organization_id: string
          planning_id: string | null
          position: number
          priority: string
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id: string
          client_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date: string
          id?: string
          organization_id: string
          planning_id?: string | null
          position?: number
          priority?: string
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string
          id?: string
          organization_id?: string
          planning_id?: string | null
          position?: number
          priority?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
        ]
      }
      team_event_attendees: {
        Row: {
          created_at: string
          event_id: string
          id: string
          organization_id: string
          response: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          organization_id: string
          response?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          organization_id?: string
          response?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_event_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "team_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_event_attendees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_event_reminders_sent: {
        Row: {
          event_id: string
          kind: string
          sent_at: string
          user_id: string
        }
        Insert: {
          event_id: string
          kind: string
          sent_at?: string
          user_id: string
        }
        Update: {
          event_id?: string
          kind?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_event_reminders_sent_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "team_events"
            referencedColumns: ["id"]
          },
        ]
      }
      team_events: {
        Row: {
          all_day: boolean
          client_id: string | null
          created_at: string
          created_by: string
          description: string | null
          ends_at: string | null
          event_type: string
          id: string
          is_default_capture: boolean
          location: string | null
          meeting_link: string | null
          organization_id: string
          planning_id: string | null
          production_step_id: string | null
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          client_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          ends_at?: string | null
          event_type?: string
          id?: string
          is_default_capture?: boolean
          location?: string | null
          meeting_link?: string | null
          organization_id: string
          planning_id?: string | null
          production_step_id?: string | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          client_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          ends_at?: string | null
          event_type?: string
          id?: string
          is_default_capture?: boolean
          location?: string | null
          meeting_link?: string | null
          organization_id?: string
          planning_id?: string | null
          production_step_id?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_events_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_events_production_step_id_fkey"
            columns: ["production_step_id"]
            isOneToOne: false
            referencedRelation: "production_item_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      team_function_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_function_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_member_functions: {
        Row: {
          organization_id: string
          tag_id: string
          user_id: string
        }
        Insert: {
          organization_id: string
          tag_id: string
          user_id: string
        }
        Update: {
          organization_id?: string
          tag_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_member_functions_member_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "team_member_functions_tag_fkey"
            columns: ["organization_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "team_function_tags"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string | null
          email: string
          id: string
          owner_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          owner_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          owner_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      template_posts: {
        Row: {
          caption: string | null
          content_type: string | null
          created_at: string | null
          hashtags: string | null
          id: string
          position: number | null
          template_id: string
        }
        Insert: {
          caption?: string | null
          content_type?: string | null
          created_at?: string | null
          hashtags?: string | null
          id?: string
          position?: number | null
          template_id: string
        }
        Update: {
          caption?: string | null
          content_type?: string | null
          created_at?: string | null
          hashtags?: string | null
          id?: string
          position?: number | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_posts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "planning_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      time_clock_absences: {
        Row: {
          created_at: string
          created_by: string
          end_date: string
          file_path: string | null
          id: string
          kind: string
          organization_id: string
          reason: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          end_date: string
          file_path?: string | null
          id?: string
          kind?: string
          organization_id: string
          reason?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          end_date?: string
          file_path?: string | null
          id?: string
          kind?: string
          organization_id?: string
          reason?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_clock_absences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_clock_adjustment_requests: {
        Row: {
          created_at: string
          id: string
          kind: string
          organization_id: string
          reason: string
          requested_punched_at: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          organization_id: string
          reason: string
          requested_punched_at: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          organization_id?: string
          reason?: string
          requested_punched_at?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_clock_adjustment_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_clock_hour_bank_baseline: {
        Row: {
          baseline_seconds: number
          effective_from: string
          note: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          baseline_seconds?: number
          effective_from?: string
          note?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          baseline_seconds?: number
          effective_from?: string
          note?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_clock_hour_bank_baseline_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_clock_punches: {
        Row: {
          adjustment_request_id: string | null
          created_at: string
          id: string
          kind: string
          note: string | null
          organization_id: string
          punched_at: string
          user_id: string
        }
        Insert: {
          adjustment_request_id?: string | null
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          organization_id: string
          punched_at?: string
          user_id: string
        }
        Update: {
          adjustment_request_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          organization_id?: string
          punched_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_clock_punches_adjustment_request_id_fkey"
            columns: ["adjustment_request_id"]
            isOneToOne: false
            referencedRelation: "time_clock_adjustment_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_clock_punches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_script_suggestions: {
        Row: {
          created_at: string
          created_by_name: string | null
          field_name: string
          id: string
          organization_id: string | null
          original_value: string | null
          planning_id: string | null
          reviewed_at: string | null
          status: string
          suggested_value: string
          video_script_id: string
        }
        Insert: {
          created_at?: string
          created_by_name?: string | null
          field_name: string
          id?: string
          organization_id?: string | null
          original_value?: string | null
          planning_id?: string | null
          reviewed_at?: string | null
          status?: string
          suggested_value: string
          video_script_id: string
        }
        Update: {
          created_at?: string
          created_by_name?: string | null
          field_name?: string
          id?: string
          organization_id?: string | null
          original_value?: string | null
          planning_id?: string | null
          reviewed_at?: string | null
          status?: string
          suggested_value?: string
          video_script_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_script_suggestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_script_suggestions_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_script_suggestions_video_script_id_fkey"
            columns: ["video_script_id"]
            isOneToOne: false
            referencedRelation: "video_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      video_scripts: {
        Row: {
          created_at: string | null
          editing_instructions: string | null
          id: string
          organization_id: string
          planning_id: string
          position: number | null
          references_notes: string | null
          scenes: Json | null
          spoken_text: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          editing_instructions?: string | null
          id?: string
          organization_id: string
          planning_id: string
          position?: number | null
          references_notes?: string | null
          scenes?: Json | null
          spoken_text?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          editing_instructions?: string | null
          id?: string
          organization_id?: string
          planning_id?: string
          position?: number | null
          references_notes?: string | null
          scenes?: Json | null
          spoken_text?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_scripts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_scripts_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      client_credentials_view: {
        Row: {
          client_id: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          notes: string | null
          organization_id: string | null
          platform: string | null
          responsible_user_id: string | null
          updated_at: string | null
          updated_by: string | null
          url: string | null
          username: string | null
          vault_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          notes?: string | null
          organization_id?: string | null
          platform?: string | null
          responsible_user_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          url?: string | null
          username?: string | null
          vault_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          notes?: string | null
          organization_id?: string | null
          platform?: string | null
          responsible_user_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          url?: string | null
          username?: string | null
          vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_credentials_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_credentials_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vault_status"
            referencedColumns: ["vault_id"]
          },
          {
            foreignKeyName: "client_credentials_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "organization_vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_vault_status: {
        Row: {
          created_at: string | null
          is_unlocked_for_me: boolean | null
          locked_until: string | null
          organization_id: string | null
          require_master_password: boolean | null
          status: string | null
          unlock_duration_minutes: number | null
          vault_id: string | null
        }
        Insert: {
          created_at?: string | null
          is_unlocked_for_me?: never
          locked_until?: string | null
          organization_id?: string | null
          require_master_password?: boolean | null
          status?: string | null
          unlock_duration_minutes?: number | null
          vault_id?: string | null
        }
        Update: {
          created_at?: string | null
          is_unlocked_for_me?: never
          locked_until?: string | null
          organization_id?: string | null
          require_master_password?: boolean | null
          status?: string | null
          unlock_duration_minutes?: number | null
          vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_vaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_organization_invitation: {
        Args: { _token: string }
        Returns: {
          created_at: string
          display_name: string | null
          id: string
          job_title: string | null
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_member_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "organization_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_video_script_suggestion: {
        Args: { _suggestion_id: string }
        Returns: {
          created_at: string
          created_by_name: string | null
          field_name: string
          id: string
          organization_id: string | null
          original_value: string | null
          planning_id: string | null
          reviewed_at: string | null
          status: string
          suggested_value: string
          video_script_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_script_suggestions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_vault_permission: {
        Args: { _organization_id: string; _permission: string }
        Returns: string
      }
      calculate_gregorian_easter: { Args: { _year: number }; Returns: string }
      can_edit_org_content: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      can_manage_team_function_tags: {
        Args: { _organization_id: string }
        Returns: boolean
      }
      can_view_team_time_clock: {
        Args: { _organization_id: string }
        Returns: boolean
      }
      cancel_scheduled_post: { Args: { _id: string }; Returns: undefined }
      create_client_credential: {
        Args: {
          _client_id: string
          _notes?: string
          _password: string
          _platform: string
          _responsible_user_id?: string
          _two_factor_notes?: string
          _url?: string
          _username?: string
        }
        Returns: string
      }
      create_organization: {
        Args: { _name: string; _slug: string }
        Returns: {
          brand_color: string | null
          client_limit: number | null
          created_at: string
          created_by: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_organization_invitation: {
        Args: {
          _email: string
          _organization_id: string
          _role?: Database["public"]["Enums"]["organization_member_role"]
        }
        Returns: {
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_invitation_status"]
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "organization_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_organization_vault: {
        Args: {
          _master_password?: string
          _organization_id: string
          _require_master_password?: boolean
        }
        Returns: string
      }
      create_scheduled_post: {
        Args: {
          _caption?: string
          _children_urls?: string[]
          _client_id: string
          _connection_id: string
          _cover_url?: string
          _image_url?: string
          _media_type?: string
          _post_id?: string
          _scheduled_for?: string
          _target?: string
          _video_url?: string
        }
        Returns: string
      }
      get_client_meta_connection_status: {
        Args: { _client_id: string }
        Returns: {
          account_type: string
          can_manage: boolean
          channel_id: string
          channel_status: string
          channel_type: string
          client_id: string
          connected_at: string
          connection_id: string
          connection_status: string
          disconnected_at: string
          display_name: string
          external_account_id: string
          granted_scopes: string[]
          last_error_code: string
          last_verified_at: string
          meta_user_name: string
          organization_id: string
          token_expires_at: string
          username: string
        }[]
      }
      get_invitation_by_token: {
        Args: { _token: string }
        Returns: {
          email: string
          expires_at: string
          organization_id: string
          organization_name: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_invitation_status"]
        }[]
      }
      get_marketing_calendar_dates: {
        Args: { _year: number }
        Returns: {
          category: string
          color: string
          description: string
          event_date: string
          id: string
          name: string
          slug: string
        }[]
      }
      get_org_role: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: Database["public"]["Enums"]["organization_member_role"]
      }
      get_org_vault_dek: { Args: { _vault_id: string }; Returns: string }
      get_organization_vault_status: {
        Args: { _organization_id: string }
        Returns: {
          created_at: string
          is_unlocked_for_me: boolean
          locked_until: string
          organization_id: string
          require_master_password: boolean
          status: string
          unlock_duration_minutes: number
          vault_id: string
        }[]
      }
      get_planning_nps_dashboard: {
        Args: {
          _classification?: string
          _client_id?: string
          _from?: string
          _organization_id: string
          _to?: string
        }
        Returns: {
          average_score: number
          classification_distribution: Json
          detractor_count: number
          last_response_at: string
          negative_count: number
          neutral_count: number
          passive_count: number
          period_distribution: Json
          positive_count: number
          promoter_count: number
          total_responses: number
        }[]
      }
      get_planning_nps_responses: {
        Args: {
          _classification?: string
          _client_id?: string
          _from?: string
          _limit?: number
          _offset?: number
          _organization_id: string
          _search?: string
          _to?: string
        }
        Returns: {
          classification: string
          client_id: string
          client_name: string
          created_at: string
          planning_id: string
          planning_label: string
          reason: string
          response_id: string
          score: number
          total_count: number
        }[]
      }
      get_posts_publish_status: {
        Args: { _post_ids: string[] }
        Returns: {
          permalink: string
          post_id: string
          scheduled_for: string
          status: string
        }[]
      }
      get_public_all_video_scripts: {
        Args: { _token: string }
        Returns: {
          created_at: string | null
          editing_instructions: string | null
          id: string
          organization_id: string
          planning_id: string
          position: number | null
          references_notes: string | null
          scenes: Json | null
          spoken_text: string | null
          title: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "video_scripts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_client: {
        Args: { _token: string }
        Returns: {
          accent_color: string
          id: string
          logo_url: string
          name: string
          notes: string
        }[]
      }
      get_public_documents: {
        Args: { _token: string }
        Returns: {
          category: string | null
          client_id: string
          created_at: string | null
          description: string | null
          file_url: string
          id: string
          name: string
          organization_id: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "client_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_plannings: {
        Args: { _token: string }
        Returns: {
          client_id: string
          created_at: string | null
          created_by: string | null
          id: string
          month: number
          notes: string | null
          organization_id: string
          status: string
          updated_at: string | null
          year: number
        }[]
        SetofOptions: {
          from: "*"
          to: "plannings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_post: {
        Args: { _post_id: string; _token: string }
        Returns: {
          blog_body: string | null
          caption: string | null
          content_type: string | null
          cover_image_url: string | null
          created_at: string | null
          hashtags: string | null
          id: string
          media_urls: Json | null
          organization_id: string
          planning_id: string
          position: number | null
          publish_date: string | null
          revision_note: string | null
          revision_reasons: string[] | null
          scheduled: boolean | null
          status: string | null
          updated_at: string | null
          video_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_post_comments: {
        Args: { _post_id: string; _token: string }
        Returns: {
          audio_url: string | null
          author_name: string | null
          author_type: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          post_id: string
          reason_codes: string[] | null
          text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "post_comments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_post_suggestions: {
        Args: { _post_id: string; _token: string }
        Returns: {
          content: string | null
          created_at: string | null
          field_name: string | null
          id: string
          original_value: string | null
          post_id: string
          status: string | null
          suggested_value: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "post_edit_suggestions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_posts: {
        Args: { _planning_id: string; _token: string }
        Returns: {
          blog_body: string | null
          caption: string | null
          content_type: string | null
          cover_image_url: string | null
          created_at: string | null
          hashtags: string | null
          id: string
          media_urls: Json | null
          organization_id: string
          planning_id: string
          position: number | null
          publish_date: string | null
          revision_note: string | null
          revision_reasons: string[] | null
          scheduled: boolean | null
          status: string | null
          updated_at: string | null
          video_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_report_comments: {
        Args: { _report_id: string; _token: string }
        Returns: {
          audio_url: string | null
          author_type: string | null
          created_at: string | null
          id: string
          report_id: string
          text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "report_comments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_reports: {
        Args: { _token: string }
        Returns: {
          ai_summary: string | null
          client_id: string
          created_at: string | null
          id: string
          month: number
          organization_id: string
          pdf_url: string | null
          summary_text: string | null
          updated_at: string | null
          user_id: string | null
          year: number
        }[]
        SetofOptions: {
          from: "*"
          to: "monthly_reports"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_video_script_suggestions: {
        Args: { _script_id: string; _token: string }
        Returns: {
          created_at: string
          created_by_name: string | null
          field_name: string
          id: string
          organization_id: string | null
          original_value: string | null
          planning_id: string | null
          reviewed_at: string | null
          status: string
          suggested_value: string
          video_script_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "video_script_suggestions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_public_video_scripts: {
        Args: { _planning_id: string; _token: string }
        Returns: {
          created_at: string | null
          editing_instructions: string | null
          id: string
          organization_id: string
          planning_id: string
          position: number | null
          references_notes: string | null
          scenes: Json | null
          spoken_text: string | null
          title: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "video_scripts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_scheduled_posts: {
        Args: { _client_id?: string; _from: string; _to: string }
        Returns: {
          attempts: number
          caption: string
          children_urls: string[] | null
          client_id: string
          connection_id: string
          cover_url: string | null
          created_at: string
          created_by: string
          error_code: string | null
          facebook_post_id: string | null
          id: string
          image_url: string | null
          instagram_media_id: string | null
          media_type: string
          organization_id: string
          permalink: string | null
          post_id: string | null
          scheduled_for: string
          status: string
          target: string
          updated_at: string
          video_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "meta_scheduled_posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_task_assignees: {
        Args: { _organization_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          job_title: string
          user_id: string
        }[]
      }
      is_org_admin_or_owner: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      is_org_member_for_client_path: {
        Args: { _name: string }
        Returns: boolean
      }
      is_org_member_for_planning_path: {
        Args: { _name: string }
        Returns: boolean
      }
      list_client_credentials: {
        Args: { _client_id?: string; _organization_id: string }
        Returns: {
          client_id: string
          created_at: string
          created_by: string
          id: string
          notes: string
          organization_id: string
          platform: string
          responsible_user_id: string
          updated_at: string
          updated_by: string
          url: string
          username: string
          vault_id: string
        }[]
      }
      lock_organization_vault: {
        Args: { _vault_id: string }
        Returns: undefined
      }
      log_client_credential_copy: { Args: { _id: string }; Returns: undefined }
      meta_can_manage_connection: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      meta_children_all_https: { Args: { _urls: string[] }; Returns: boolean }
      meta_server_claim_due_scheduled_posts: {
        Args: { _limit?: number }
        Returns: {
          caption: string
          children_urls: string[]
          connection_id: string
          cover_url: string
          facebook_page_id: string
          id: string
          image_url: string
          instagram_account_id: string
          media_type: string
          target: string
          video_url: string
        }[]
      }
      meta_server_consume_oauth_state: {
        Args: { _state_hash: string }
        Returns: {
          client_id: string
          oauth_state_id: string
          organization_id: string
          redirect_path: string
          requested_by: string
          requested_scopes: string[]
        }[]
      }
      meta_server_create_oauth_state: {
        Args: {
          _client_id: string
          _expires_at: string
          _redirect_path: string
          _request_id?: string
          _requested_by: string
          _requested_scopes: string[]
          _state_hash: string
        }
        Returns: string
      }
      meta_server_create_pending_connection: {
        Args: {
          _access_token: string
          _granted_scopes: string[]
          _meta_user_id: string
          _meta_user_name?: string
          _oauth_state_id: string
          _request_id?: string
          _token_expires_at: string
        }
        Returns: string
      }
      meta_server_disconnect_connection: {
        Args: {
          _actor_user_id: string
          _connection_id: string
          _reason_code?: string
          _request_id?: string
        }
        Returns: undefined
      }
      meta_server_finalize_connection: {
        Args: {
          _actor_user_id: string
          _connection_id: string
          _facebook_page_id: string
          _facebook_page_name: string
          _instagram_account_id?: string
          _instagram_account_type?: string
          _instagram_display_name?: string
          _instagram_username?: string
          _page_tasks?: string[]
          _request_id?: string
        }
        Returns: undefined
      }
      meta_server_flag_connection_reauth: {
        Args: { _connection_id: string }
        Returns: undefined
      }
      meta_server_get_connection_token: {
        Args: { _connection_id: string }
        Returns: string
      }
      meta_server_mark_connection_reauth: {
        Args: {
          _connection_id: string
          _reason_code?: string
          _request_id?: string
        }
        Returns: boolean
      }
      meta_server_mark_scheduled_failed: {
        Args: { _error_code: string; _id: string }
        Returns: undefined
      }
      meta_server_mark_scheduled_published: {
        Args: { _id: string; _media_id: string; _permalink?: string }
        Returns: undefined
      }
      meta_server_record_audit: {
        Args: {
          _action: string
          _actor_user_id: string
          _client_id: string
          _connection_id: string
          _reason_code?: string
          _request_id?: string
          _result: string
        }
        Returns: string
      }
      meta_server_remove_connection_token: {
        Args: {
          _actor_user_id: string
          _connection_id: string
          _reason_code?: string
          _request_id?: string
        }
        Returns: undefined
      }
      meta_server_replace_connection_token: {
        Args: {
          _access_token: string
          _actor_user_id: string
          _connection_id: string
          _request_id?: string
          _token_expires_at: string
        }
        Returns: undefined
      }
      notify_team_event_reminders: { Args: never; Returns: undefined }
      notify_upcoming_calendar_events: { Args: never; Returns: undefined }
      production_pipeline: {
        Args: never
        Returns: {
          content_type: string
          kind: string
          label: string
          pos: number
          role: string
          step_key: string
        }[]
      }
      public_delete_post_comment: {
        Args: { _comment_id: string; _token: string }
        Returns: undefined
      }
      public_insert_edit_suggestion: {
        Args: {
          _field_name: string
          _original_value: string
          _post_id: string
          _suggested_value: string
          _token: string
        }
        Returns: {
          content: string | null
          created_at: string | null
          field_name: string | null
          id: string
          original_value: string | null
          post_id: string
          status: string | null
          suggested_value: string | null
        }
        SetofOptions: {
          from: "*"
          to: "post_edit_suggestions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_insert_post_comment: {
        Args: {
          _audio_url?: string
          _author_name: string
          _post_id: string
          _reason_codes?: string[]
          _text: string
          _token: string
        }
        Returns: {
          audio_url: string | null
          author_name: string | null
          author_type: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          post_id: string
          reason_codes: string[] | null
          text: string | null
        }
        SetofOptions: {
          from: "*"
          to: "post_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_insert_report_comment: {
        Args: {
          _audio_url?: string
          _author_name: string
          _report_id: string
          _text: string
          _token: string
        }
        Returns: {
          audio_url: string | null
          author_type: string | null
          created_at: string | null
          id: string
          report_id: string
          text: string | null
        }
        SetofOptions: {
          from: "*"
          to: "report_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_insert_video_script_suggestion: {
        Args: {
          _author_name?: string
          _field_name: string
          _original_value: string
          _script_id: string
          _suggested_value: string
          _token: string
        }
        Returns: {
          created_at: string
          created_by_name: string | null
          field_name: string
          id: string
          organization_id: string | null
          original_value: string | null
          planning_id: string | null
          reviewed_at: string | null
          status: string
          suggested_value: string
          video_script_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_script_suggestions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_notify_planning_viewed: {
        Args: { _planning_id: string; _token: string }
        Returns: undefined
      }
      public_request_post_revision: {
        Args: {
          _note?: string
          _post_id: string
          _reasons: string[]
          _token: string
        }
        Returns: {
          blog_body: string | null
          caption: string | null
          content_type: string | null
          cover_image_url: string | null
          created_at: string | null
          hashtags: string | null
          id: string
          media_urls: Json | null
          organization_id: string
          planning_id: string
          position: number | null
          publish_date: string | null
          revision_note: string | null
          revision_reasons: string[] | null
          scheduled: boolean | null
          status: string | null
          updated_at: string | null
          video_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_submit_planning_nps: {
        Args: {
          _planning_id: string
          _reason?: string
          _score: number
          _token: string
        }
        Returns: {
          accepted: boolean
          next_allowed_at: string
          response_id: string
        }[]
      }
      public_update_planning_status: {
        Args: { _new_status: string; _planning_id: string; _token: string }
        Returns: {
          client_id: string
          created_at: string | null
          created_by: string | null
          id: string
          month: number
          notes: string | null
          organization_id: string
          status: string
          updated_at: string | null
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "plannings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_update_post_comment: {
        Args: { _comment_id: string; _text: string; _token: string }
        Returns: {
          audio_url: string | null
          author_name: string | null
          author_type: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          post_id: string
          reason_codes: string[] | null
          text: string | null
        }
        SetofOptions: {
          from: "*"
          to: "post_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_update_post_status: {
        Args: { _new_status: string; _post_id: string; _token: string }
        Returns: {
          blog_body: string | null
          caption: string | null
          content_type: string | null
          cover_image_url: string | null
          created_at: string | null
          hashtags: string | null
          id: string
          media_urls: Json | null
          organization_id: string
          planning_id: string
          position: number | null
          publish_date: string | null
          revision_note: string | null
          revision_reasons: string[] | null
          scheduled: boolean | null
          status: string | null
          updated_at: string | null
          video_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      realign_production_item: {
        Args: { _item_id: string }
        Returns: undefined
      }
      reject_video_script_suggestion: {
        Args: { _suggestion_id: string }
        Returns: {
          created_at: string
          created_by_name: string | null
          field_name: string
          id: string
          organization_id: string | null
          original_value: string | null
          planning_id: string | null
          reviewed_at: string | null
          status: string
          suggested_value: string
          video_script_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_script_suggestions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_org_id_from_vault: {
        Args: { _vault_id: string }
        Returns: string
      }
      reveal_client_credential: { Args: { _id: string }; Returns: Json }
      revoke_vault_member_access: {
        Args: { _user_id: string; _vault_id: string }
        Returns: undefined
      }
      set_vault_master_password_requirement: {
        Args: {
          _current_master_password?: string
          _new_master_password?: string
          _require: boolean
          _vault_id: string
        }
        Returns: undefined
      }
      set_vault_member_access: {
        Args: {
          _can_manage?: boolean
          _can_manage_settings?: boolean
          _can_reveal?: boolean
          _can_view?: boolean
          _user_id: string
          _vault_id: string
        }
        Returns: undefined
      }
      soft_delete_client_credential: {
        Args: { _id: string }
        Returns: undefined
      }
      storage_first_segment_uuid: { Args: { _name: string }; Returns: string }
      unlock_organization_vault: {
        Args: { _master_password: string; _vault_id: string }
        Returns: Json
      }
      update_client_credential: {
        Args: {
          _id: string
          _new_password?: string
          _notes?: string
          _platform?: string
          _responsible_user_id?: string
          _two_factor_notes?: string
          _url?: string
          _username?: string
        }
        Returns: undefined
      }
      update_vault_unlock_duration: {
        Args: { _unlock_duration_minutes: number; _vault_id: string }
        Returns: undefined
      }
      vault_can_manage: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      vault_can_manage_settings: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      vault_can_reveal: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      vault_can_view: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      vault_has_any_access: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      vault_permission_ok: {
        Args: {
          _organization_id: string
          _permission: string
          _user_id?: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "collaborator" | "client"
      organization_invitation_status:
        | "pending"
        | "accepted"
        | "revoked"
        | "expired"
      organization_member_role:
        | "owner"
        | "admin"
        | "manager"
        | "editor"
        | "viewer"
      organization_member_status: "active" | "suspended" | "removed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "collaborator", "client"],
      organization_invitation_status: [
        "pending",
        "accepted",
        "revoked",
        "expired",
      ],
      organization_member_role: [
        "owner",
        "admin",
        "manager",
        "editor",
        "viewer",
      ],
      organization_member_status: ["active", "suspended", "removed"],
    },
  },
} as const
