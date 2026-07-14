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
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
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
      clients: {
        Row: {
          accent_color: string | null
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
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
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
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
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
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_member_role"]
          status: Database["public"]["Enums"]["organization_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_member_role"]
          status?: Database["public"]["Enums"]["organization_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
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
      profiles: {
        Row: {
          active_organization_id: string | null
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          active_organization_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          active_organization_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
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
      [_ in never]: never
    }
    Functions: {
      accept_organization_invitation: {
        Args: { _token: string }
        Returns: {
          created_at: string
          id: string
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
      can_edit_org_content: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: boolean
      }
      create_organization: {
        Args: { _name: string; _slug: string }
        Returns: {
          brand_color: string | null
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
      get_org_role: {
        Args: { _organization_id: string; _user_id?: string }
        Returns: Database["public"]["Enums"]["organization_member_role"]
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
      storage_first_segment_uuid: { Args: { _name: string }; Returns: string }
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

