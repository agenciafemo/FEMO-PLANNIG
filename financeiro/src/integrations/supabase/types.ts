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
  public: {
    Tables: {
      categorias: {
        Row: {
          created_at: string
          id: string
          nome: string
          tipo: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          tipo?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          tipo?: string
        }
        Relationships: []
      }
      checklist_prospeccao: {
        Row: {
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
      clientes: {
        Row: {
          created_at: string
          data_aniversario: string | null
          data_entrada: string
          data_saida: string | null
          data_status_alterado: string | null
          dia_vencimento: number
          id: string
          id_cliente_asaas: string | null
          is_recorrente: boolean
          nome: string
          pct_social_media: number
          pct_trafego: number
          socios: string[]
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
          valor_mensalidade: number
        }
        Insert: {
          created_at?: string
          data_aniversario?: string | null
          data_entrada: string
          data_saida?: string | null
          data_status_alterado?: string | null
          dia_vencimento?: number
          id?: string
          id_cliente_asaas?: string | null
          is_recorrente?: boolean
          nome: string
          pct_social_media?: number
          pct_trafego?: number
          socios?: string[]
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          valor_mensalidade?: number
        }
        Update: {
          created_at?: string
          data_aniversario?: string | null
          data_entrada?: string
          data_saida?: string | null
          data_status_alterado?: string | null
          dia_vencimento?: number
          id?: string
          id_cliente_asaas?: string | null
          is_recorrente?: boolean
          nome?: string
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
      configuracoes: {
        Row: {
          cor_fundo: string
          cor_primaria: string
          cor_secundaria: string
          id: number
          logo_url: string | null
          pct_penalidade_atraso: number
          pct_penalidade_churn: number
          pct_reserva: number
          pct_rotativa: number
          updated_at: string
        }
        Insert: {
          cor_fundo?: string
          cor_primaria?: string
          cor_secundaria?: string
          id?: number
          logo_url?: string | null
          pct_penalidade_atraso?: number
          pct_penalidade_churn?: number
          pct_reserva?: number
          pct_rotativa?: number
          updated_at?: string
        }
        Update: {
          cor_fundo?: string
          cor_primaria?: string
          cor_secundaria?: string
          id?: number
          logo_url?: string | null
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
          cliente_id: string
          colaborador_id: string
          created_at: string
          id: string
          prazo_entrega_planejamentos: number | null
          status_entrega_mes_atual: Database["public"]["Enums"]["status_entrega"]
          valor_base_calculo: number
        }
        Insert: {
          cliente_id: string
          colaborador_id: string
          created_at?: string
          id?: string
          prazo_entrega_planejamentos?: number | null
          status_entrega_mes_atual?: Database["public"]["Enums"]["status_entrega"]
          valor_base_calculo?: number
        }
        Update: {
          cliente_id?: string
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
          created_at: string
          descricao: string | null
          id: string
          nome: string
          tipo_base: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          tipo_base?: string
          updated_at?: string
        }
        Update: {
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
          categoria_id: string | null
          cliente_id: string | null
          codigo_pix: string | null
          colaborador_id: string | null
          created_at: string
          data_lancamento: string
          descricao: string | null
          id: string
          id_cobranca_asaas: string | null
          is_clawback: boolean
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
          categoria_id?: string | null
          cliente_id?: string | null
          codigo_pix?: string | null
          colaborador_id?: string | null
          created_at?: string
          data_lancamento: string
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
          tipo: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at?: string
          valor: number
        }
        Update: {
          categoria_id?: string | null
          cliente_id?: string | null
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
          colaborador_id: string
          created_at: string
          id: string
          mes_competencia: string
          peso: number
          updated_at: string
        }
        Insert: {
          colaborador_id: string
          created_at?: string
          id?: string
          mes_competencia: string
          peso?: number
          updated_at?: string
        }
        Update: {
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
          colaborador_id: string
          created_at: string
          data_referencia: string
          descricao: string
          id: string
          valor: number
        }
        Insert: {
          colaborador_id: string
          created_at?: string
          data_referencia: string
          descricao: string
          id?: string
          valor: number
        }
        Update: {
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
          created_at: string
          funcao_id: string | null
          id: string
          meses_max: number | null
          meses_min: number
          percentual: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          funcao_id?: string | null
          id?: string
          meses_max?: number | null
          meses_min: number
          percentual: number
          updated_at?: string
        }
        Update: {
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gerar_cobrancas_recorrentes: { Args: { _mes: string }; Returns: number }
    }
    Enums: {
      app_role: "admin"
      cargo_colaborador:
        | "Social Media"
        | "Gestor de Tráfego"
        | "Outros"
        | "Líder"
      client_status: "Ativo" | "Churn"
      lancamento_tipo: "Entrada" | "Saída"
      payment_status: "Pago" | "Pendente" | "Inadimplente"
      status_entrega: "Entregue no Prazo" | "Entregue com Atraso"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
      cargo_colaborador: [
        "Social Media",
        "Gestor de Tráfego",
        "Outros",
        "Líder",
      ],
      client_status: ["Ativo", "Churn"],
      lancamento_tipo: ["Entrada", "Saída"],
      payment_status: ["Pago", "Pendente", "Inadimplente"],
      status_entrega: ["Entregue no Prazo", "Entregue com Atraso"],
    },
  },
} as const
