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
      client_documents: {
        Row: {
          category: string
          client_id: string
          created_at: string
          description: string | null
          file_url: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          category?: string
          client_id: string
          created_at?: string
          description?: string | null
          file_url: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          category?: string
          client_id?: string
          created_at?: string
          description?: string | null
          file_url?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          accent_color: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          notes: string | null
          public_link_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accent_color?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          notes?: string | null
          public_link_token?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accent_color?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          notes?: string | null
          public_link_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      monthly_reports: {
        Row: {
          ai_summary: string | null
          client_id: string
          created_at: string
          id: string
          month: number
          pdf_url: string | null
          summary_text: string | null
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          ai_summary?: string | null
          client_id: string
          created_at?: string
          id?: string
          month: number
          pdf_url?: string | null
          summary_text?: string | null
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          ai_summary?: string | null
          client_id?: string
          created_at?: string
          id?: string
          month?: number
          pdf_url?: string | null
          summary_text?: string | null
          updated_at?: string
          user_id?: string
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
        ]
      }
      planning_templates: {
        Row: {
          created_at: string
          default_post_count: number
          default_stories_count: number
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_post_count?: number
          default_stories_count?: number
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_post_count?: number
          default_stories_count?: number
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plannings: {
        Row: {
          client_id: string
          created_at: string
          id: string
          month: number
          notes: string | null
          status: string
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          month: number
          notes?: string | null
          status?: string
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          month?: number
          notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
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
        ]
      }
      post_comments: {
        Row: {
          audio_url: string | null
          author_name: string | null
          author_type: string
          created_at: string
          id: string
          post_id: string
          text: string | null
        }
        Insert: {
          audio_url?: string | null
          author_name?: string | null
          author_type: string
          created_at?: string
          id?: string
          post_id: string
          text?: string | null
        }
        Update: {
          audio_url?: string | null
          author_name?: string | null
          author_type?: string
          created_at?: string
          id?: string
          post_id?: string
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
          created_at: string
          field_name: string
          id: string
          original_value: string | null
          post_id: string
          status: string
          suggested_value: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_name: string
          id?: string
          original_value?: string | null
          post_id: string
          status?: string
          suggested_value: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_name?: string
          id?: string
          original_value?: string | null
          post_id?: string
          status?: string
          suggested_value?: string
          updated_at?: string
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
          content_type: string
          cover_image_url: string | null
          created_at: string
          hashtags: string | null
          id: string
          media_urls: string[] | null
          planning_id: string
          position: number
          publish_date: string | null
          scheduled: boolean
          status: string
          topic_brief: string | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          blog_body?: string | null
          caption?: string | null
          content_type?: string
          cover_image_url?: string | null
          created_at?: string
          hashtags?: string | null
          id?: string
          media_urls?: string[] | null
          planning_id: string
          position?: number
          publish_date?: string | null
          scheduled?: boolean
          status?: string
          topic_brief?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          blog_body?: string | null
          caption?: string | null
          content_type?: string
          cover_image_url?: string | null
          created_at?: string
          hashtags?: string | null
          id?: string
          media_urls?: string[] | null
          planning_id?: string
          position?: number
          publish_date?: string | null
          scheduled?: boolean
          status?: string
          topic_brief?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "plannings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      report_comments: {
        Row: {
          audio_url: string | null
          author_name: string | null
          author_type: string
          created_at: string
          id: string
          report_id: string
          text: string | null
        }
        Insert: {
          audio_url?: string | null
          author_name?: string | null
          author_type: string
          created_at?: string
          id?: string
          report_id: string
          text?: string | null
        }
        Update: {
          audio_url?: string | null
          author_name?: string | null
          author_type?: string
          created_at?: string
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
      team_members: {
        Row: {
          created_at: string
          email: string
          id: string
          owner_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          owner_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
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
          content_type: string
          created_at: string
          hashtags: string | null
          id: string
          position: number
          template_id: string
        }
        Insert: {
          caption?: string | null
          content_type?: string
          created_at?: string
          hashtags?: string | null
          id?: string
          position?: number
          template_id: string
        }
        Update: {
          caption?: string | null
          content_type?: string
          created_at?: string
          hashtags?: string | null
          id?: string
          position?: number
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
      video_scripts: {
        Row: {
          created_at: string
          editing_instructions: string | null
          id: string
          planning_id: string
          position: number
          references_notes: string | null
          spoken_text: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          editing_instructions?: string | null
          id?: string
          planning_id: string
          position?: number
          references_notes?: string | null
          spoken_text?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          editing_instructions?: string | null
          id?: string
          planning_id?: string
          position?: number
          references_notes?: string | null
          spoken_text?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
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
      [_ in never]: never
    }
    Functions: {
      get_accessible_user_ids: { Args: never; Returns: string[] }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
